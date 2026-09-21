import { verifyToken } from '../../lib/auth-middleware.js'

export const config = {
    api: {
        bodyParser: { sizeLimit: '8mb' }
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (!verifyToken(req)) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนใช้งานผู้ช่วย AI' })

    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
    if (!message) return res.status(400).json({ error: 'กรุณาพิมพ์คำถาม' })
    if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบ' })

    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
    const repairMode = req.body?.mode === 'repair'
    const image = typeof req.body?.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(req.body.image)
        ? req.body.image
        : null
    if (repairMode && !image) return res.status(400).json({ error: 'กรุณาแนบรูปภาพปัญหาก่อนให้ AI วิเคราะห์' })
    const systemInstruction = repairMode
        ? `คุณคือผู้ช่วยจัดทำใบแจ้งซ่อมของโรงเรียนสรรพวิทยาคม วิเคราะห์ข้อความและภาพ (ถ้ามี) แล้วตอบเป็น JSON เท่านั้น ห้ามใส่ Markdown หรือข้อความอื่น รูปแบบ JSON คือ {"category":"ไฟฟ้า|ประปา|อาคาร|คอมพิวเตอร์","sub_category":"หัวข้อย่อยที่เหมาะสมหรืออื่นๆ","title":"หัวข้อสั้นๆ","description":"รายละเอียดอาการที่เรียบเรียงจากข้อมูลที่ได้รับ","location_detail":"ห้อง/ชั้น/จุดสังเกตจากข้อมูล หรือเว้นว่าง","missing":["ข้อมูลที่ควรถามเพิ่ม"]} ห้ามเดาสถานที่หรืออาการที่มองไม่เห็น หากข้อมูลไม่พอให้ใส่คำถามใน missing และยังคงตอบ JSON`
        : 'คุณคือผู้ช่วยของระบบแจ้งซ่อมบำรุงโรงเรียนสรรพวิทยาคม ตอบเป็นภาษาไทย สุภาพ กระชับ และช่วยแนะนำขั้นตอนแจ้งซ่อม/ติดตามสถานะ หากไม่ทราบข้อมูลเฉพาะให้บอกผู้ใช้ให้ติดต่อเจ้าหน้าที่ ห้ามแต่งข้อมูลสถานะงานหรือข้อมูลส่วนตัวขึ้นเอง ตอบให้จบเป็นประโยคสมบูรณ์ ห้ามหยุดกลางประโยค'
    const parts = [{ text: message }]
    if (image) parts.push({ inline_data: { mime_type: image.match(/^data:(image\/(?:png|jpeg|webp));/)?.[1], data: image.split(',')[1] } })

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: 'user', parts }],
                generationConfig: { temperature: repairMode ? 0.2 : 0.4, maxOutputTokens: repairMode ? 800 : 1000, ...(repairMode && { responseMimeType: 'application/json' }) }
            })
        })
        const rawBody = await response.text()
        let data = {}
        try { data = JSON.parse(rawBody) } catch { }
        if (!response.ok) {
            const providerMessage = data.error?.message || `Google API returned HTTP ${response.status}`
            console.error('Gemini API error', { status: response.status, model, message: providerMessage })
            const status = response.status === 429 ? 429 : 502
            return res.status(status).json({ error: 'บริการ AI ไม่พร้อมใช้งานในขณะนี้', detail: providerMessage })
        }
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
        if (repairMode) {
            try {
                return res.status(200).json({ repair: JSON.parse(reply || '{}') })
            } catch {
                console.error('Gemini repair response was not valid JSON')
                return res.status(502).json({ error: 'AI ส่งผลลัพธ์ไม่ถูกต้อง กรุณาลองใหม่' })
            }
        }
        return res.status(200).json({ reply: reply || 'ยังไม่มีคำตอบสำหรับคำถามนี้ครับ' })
    } catch {
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเชื่อมต่อบริการ AI' })
    }
}