import { connectDB } from '../../lib/db.js'
import { verifyToken } from '../../lib/auth-middleware.js'
import { ObjectId } from 'mongodb'

export default async function handler(req, res) {

    // GET — ดึงคำขอซ่อมของตัวเอง
    if (req.method === 'GET') {
        const user = verifyToken(req)
        if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' })

        const db = await connectDB()
        const col = db.collection('repair_requests')

        // admin เห็นทั้งหมด, student เห็นแค่ของตัวเอง
        const filter = (user.role === 'admin' || user.role === 'technician') ? {} : { reporter_id: user.userId }
        const requests = await col.find(filter).sort({ created_at: -1 }).toArray()

        // เติมชื่อให้รายการเก่าที่ยังไม่มี reporter_name
        const reporterIds = [...new Set(requests
            .filter(request => !request.reporter_name && request.reporter_id)
            .map(request => String(request.reporter_id)))]
        if (reporterIds.length) {
            const users = await db.collection('users').find({
                _id: { $in: reporterIds.map(id => ObjectId.isValid(id) ? new ObjectId(id) : id) }
            }).project({ name: 1 }).toArray()
            const namesById = new Map(users.map(reporter => [String(reporter._id), reporter.name]))
            requests.forEach(request => {
                if (!request.reporter_name) request.reporter_name = namesById.get(String(request.reporter_id)) || null
            })
        }

        return res.status(200).json(requests)
    }

    // POST — สร้างคำขอซ่อมใหม่
    if (req.method === 'POST') {
        const user = verifyToken(req)
        if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' })

        const {
            title,
            category,
            sub_category,
            location_building,
            location_detail,
            description,
            contact_number,
            image_url
        } = req.body

        // เช็คข้อมูลที่จำเป็น
        if (!title || !location_building || !description || !contact_number) {
            return res.status(400).json({ error: 'กรอกข้อมูลให้ครบ' })
        }
        if (!/^0\d{9}$/.test(String(contact_number).trim())) {
            return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรศัพท์ 10 หลัก' })
        }

        const db = await connectDB()
        const col = db.collection('repair_requests')

        const result = await col.insertOne({
            title,
            category,
            sub_category: sub_category || null,
            location_building,
            location_detail,
            description,
            contact_number,
            image_url: image_url || null,
            status: 'pending',
            reporter_id: user.userId,
            reporter_name: user.name,
            created_at: new Date()
        })

        return res.status(201).json({ success: true, id: result.insertedId })
    }

    return res.status(405).json({ error: 'Method not allowed' })
}