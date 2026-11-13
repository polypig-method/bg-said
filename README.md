# BG Said

ทุกวันทำการหลังตลาดสหรัฐปิด BG Said จะสแกนหุ้น S&P 500 ด้วยสูตร Benjamin Graham แล้วส่ง 5 หุ้นที่ "น่าศึกษา" เข้ามือถือผ่านแอป ntfy ข้อมูลทั้งหมดดูได้ในเว็บแอป (PWA)

```
V = EPS × (8.5 + 2g) × 4.4 ÷ Y          MOS = (V − ราคา) ÷ V
```

| ส่วน | ที่มา |
|---|---|
| EPS, ราคา, งบ | Yahoo Finance (yfinance) |
| Y | Moody's Seasoned AAA Corporate Bond Yield, FRED `DAAA` |
| รายชื่อหุ้น | S&P 500 constituents (datasets/s-and-p-500-companies) |

g = ค่าที่ **ต่ำกว่า** ระหว่าง EPS CAGR ย้อนหลังประมาณ 4 ปี กับการเติบโต EPS ที่คาดการณ์ไว้สำหรับปีหน้า โดยจำกัดไว้ที่ 0–15%
Top 5 = หุ้นที่ EPS เป็นบวกทุกปี ผ่านเกณฑ์คุณภาพอย่างน้อย 4/6 ข้อ แล้วเรียงตาม MOS สูงสุด ไม่เกิน 2 ตัวต่อกลุ่มอุตสาหกรรม และตัดตัวที่ MOS เกิน 85% ออก
ค่าตั้งต้นทั้งหมดอยู่ที่ส่วนบนของ `engine/bgsaid.py`

## โครงสร้าง
```
engine/bgsaid.py          ดึงข้อมูล → คำนวณ → เขียน docs/data → ส่งแจ้งเตือน ntfy
docs/                     เว็บแอป (GitHub Pages จาก /docs)
  data/latest.json        ผลล่าสุด (ทุกหุ้น)
  data/history.json       Top 5 ย้อนหลัง ~1 ปี
.github/workflows/daily.yml   รัน 22:00 UTC จันทร์–ศุกร์ (05:00 น. เวลาไทย)
```

## รันบนเครื่อง
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python engine/bgsaid.py --no-notify          # คำนวณอย่างเดียว
NTFY_TOPIC=<topic> .venv/bin/python engine/bgsaid.py --force   # ส่งแจ้งเตือนทดสอบ
```

## ตั้งค่า GitHub (ทำครั้งเดียว)
1. สร้าง repo แบบ **public** ชื่อ `bg-said` แล้ว push โฟลเดอร์นี้ขึ้นไป
2. Settings → Secrets and variables → Actions
   - Secret `NTFY_TOPIC` = ชื่อ topic ใน `PRIVATE.md`
   - Variable `SITE_URL` = `https://<username>.github.io/bg-said/`
3. Settings → Pages → Source: *Deploy from a branch* → `main` / `/docs`
4. Actions → *BG Said daily scan* → Run workflow (ติ๊ก force) เพื่อทดสอบ

## แจ้งเตือนในมือถือ
ติดตั้งแอป ntfy → กด + → ใส่ topic จาก `PRIVATE.md` (ใช้เซิร์ฟเวอร์ ntfy.sh) ถ้ารอบไหนรันไม่สำเร็จ จะมีแจ้งเตือน "BG Said update failed" ส่งมาที่ topic เดียวกัน

> BG Said เป็นเครื่องมือคัดกรองหุ้นเพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน

## แอป Mac
`mac/Sources/main.swift` เป็นหน้าต่างแบบ native (AppKit + WKWebView) ที่เปิดเว็บ BG Said ตัวจริง ถ้าออฟไลน์จะใช้สำเนาที่ฝังไว้ในแอปแทน และขณะที่แอปเปิดอยู่ จะแจ้งเตือนบน macOS เมื่อมี Top 5 ของวันใหม่
```bash
./mac/build.sh 1.0      # → BG Said.dmg (ใช้แค่ Command Line Tools ไม่ต้องมี Xcode)
```
