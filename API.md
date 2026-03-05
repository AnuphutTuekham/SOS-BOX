
## Data store
- เก็บข้อมูลที่ `data/boxes.json`
- ไฟล์นี้ถูกใส่ไว้ใน `.gitignore` เพื่อไม่ให้ข้อมูลจริงหลุดไปใน git

## Endpoints
### GET `/api/boxes`
คืนค่าเป็น array ของกล่องทั้งหมด

ตัวอย่าง response:
```json
[
  {
    "id": "box-001",
    "lat": 13.7563,
    "lng": 100.5018,
    "name": "SOS BOX #1",
    "note": "",
    "batteryPercent": 84,
    "powerbankMah": 10000,
    "loadW": 5,
    "lastSeen": 1730000000000,
    "createdAt": 1730000000000
  }
]
```

### POST `/api/boxes/upsert`
อัปเดต/เพิ่มข้อมูลกล่อง (ส่งมา 1 กล่อง หรือส่งเป็น array ก็ได้)

- ต้องมี `lat` และ `lng`
- ถ้าไม่ส่ง `id` เซิร์ฟเวอร์จะสร้างให้
- ถ้าไม่ส่ง `lastSeen` เซิร์ฟเวอร์จะใช้เวลาปัจจุบัน

ตัวอย่าง (ส่ง 1 กล่อง):
```bash
curl -X POST http://127.0.0.1:5175/api/boxes/upsert \
  -H "Content-Type: application/json" \
  -d '{
    "id":"box-001",
    "lat":13.7563,
    "lng":100.5018,
    "name":"SOS BOX #1",
    "batteryPercent":84,
    "powerbankMah":10000,
    "loadW":5,
    "lastSeen":1730000000000
  }'
```

ตัวอย่าง (ส่งหลายกล่อง):
```bash
curl -X POST http://127.0.0.1:5175/api/boxes/upsert \
  -H "Content-Type: application/json" \
  -d '[
    {"id":"box-001","lat":13.7563,"lng":100.5018,"batteryPercent":84},
    {"id":"box-002","lat":13.7463,"lng":100.5318,"batteryPercent":20}
  ]'
```

### DELETE `/api/boxes`
ลบข้อมูลทั้งหมด (ใช้สำหรับรีเซ็ต)

### DELETE `/api/boxes/:id`
ลบข้อมูลเฉพาะกล่อง

## Cloudflare D1 database

This project deploys a Worker to Cloudflare at:

```
https://sos-box-worker.anuphut.workers.dev
```

The worker uses a D1 database binding named `sos_boxbd` (see `wrangler.json`). The `sosbox` table
contains the box records along with a `wifi_count` column.

You can run SQL against the remote database with Wrangler:

```bash
# make sure you're logged in
wrangler login

# show tables
wrangler d1 execute sos_boxbd --remote --sql "SELECT name FROM sqlite_master WHERE type='table';"

# sample query
wrangler d1 execute sos_boxbd --remote --sql "SELECT id,name,lat,lon,wifi_count FROM sosbox LIMIT 5;"
```

Or simply hit the HTTP endpoints to view/update data:

```bash
curl https://sos-box-worker.anuphut.workers.dev/api/boxes
curl https://sos-box-worker.anuphut.workers.dev/api/boxes/1/wifi_count
curl -X POST -H "Content-Type: application/json" \
  -d '{"wifi_count":12}' \
  https://sos-box-worker.anuphut.workers.dev/api/boxes/1/wifi_count
```


## Optional: API Key
ถ้าตั้งค่า env `SOSBOX_API_KEY` เซิร์ฟเวอร์จะบังคับให้ส่ง header `x-api-key` ทุก request ของ `/api/*`

ตัวอย่าง:
```bash
curl http://127.0.0.1:5175/api/boxes \
  -H "x-api-key: YOUR_KEY"
```
