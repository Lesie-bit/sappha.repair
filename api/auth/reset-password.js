import { connectDB } from '../../lib/db.js'
import bcrypt from 'bcryptjs'
import { hashOtp } from '../../lib/email.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email: rawEmail, otp, password } = req.body || {}
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  const normalizedOtp = typeof otp === 'string' ? otp.trim() : ''

  if (!email || !/^\d{6}$/.test(normalizedOtp) || typeof password !== 'string') {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' })
  }

  const db = await connectDB()
  const resets = db.collection('password_resets')
  const reset = await resets.findOne({ email })

  if (!reset || reset.expires_at <= new Date()) {
    return res.status(400).json({ error: 'รหัส OTP หมดอายุหรือไม่ถูกต้อง กรุณาขอรหัสใหม่' })
  }
  if (reset.attempts >= 5) {
    await resets.deleteOne({ _id: reset._id })
    return res.status(429).json({ error: 'กรอกรหัสผิดเกินกำหนด กรุณาขอรหัสใหม่' })
  }
  if (hashOtp(normalizedOtp) !== reset.otp_hash) {
    await resets.updateOne({ _id: reset._id }, { $inc: { attempts: 1 } })
    return res.status(400).json({ error: 'รหัส OTP ไม่ถูกต้อง' })
  }

  const result = await db.collection('users').updateOne(
    { email },
    { $set: { password_hash: await bcrypt.hash(password, 10) } }
  )
  await resets.deleteOne({ _id: reset._id })

  if (!result.matchedCount) {
    return res.status(400).json({ error: 'ไม่พบบัญชีผู้ใช้นี้' })
  }
  return res.status(200).json({ success: true })
}
