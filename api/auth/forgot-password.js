import { connectDB } from '../../lib/db.js'
import crypto from 'node:crypto'
import { createEmailTransporter, hashOtp } from '../../lib/email.js'

const OTP_EXPIRY_MS = 10 * 60 * 1000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rawEmail = req.body?.email
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@sappha\.ac\.th$/.test(email)) {
    return res.status(400).json({ error: 'กรุณากรอกอีเมลโรงเรียนให้ถูกต้อง' })
  }

  const db = await connectDB()
  const user = await db.collection('users').findOne({ email })

  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'หากอีเมลนี้มีบัญชีอยู่ ระบบจะส่ง OTP ไปให้'
    })
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return res.status(503).json({ error: 'ระบบส่งอีเมลยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ' })
  }

  const otp = crypto.randomInt(100000, 1000000).toString()
  const resets = db.collection('password_resets')
  await resets.deleteMany({ expires_at: { $lt: new Date() } })
  await resets.updateOne(
    { email },
    {
      $set: {
        email,
        otp_hash: hashOtp(otp),
        expires_at: new Date(Date.now() + OTP_EXPIRY_MS),
        attempts: 0,
        created_at: new Date()
      }
    },
    { upsert: true }
  )

  try {
    const transporter = createEmailTransporter()
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'รหัส OTP สำหรับตั้งรหัสผ่านใหม่',
      text: `รหัส OTP สำหรับตั้งรหัสผ่านใหม่คือ ${otp}\nรหัสนี้ใช้ได้ภายใน 10 นาที`,
      html: `<p>รหัส OTP สำหรับตั้งรหัสผ่านใหม่คือ</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otp}</p><p>รหัสนี้ใช้ได้ภายใน 10 นาที</p>`
    })
  } catch (error) {
    await resets.deleteOne({ email })
    console.error('Password reset SMTP error', error)
    return res.status(502).json({ error: 'ส่ง OTP ไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าอีเมล' })
  }

  return res.status(200).json({ success: true, message: 'ส่ง OTP ไปยังอีเมลแล้ว' })
}
