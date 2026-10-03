Buat sebuah aplikasi **AI API Gateway untuk shared/patungan quota Mimo** dengan arsitektur production-ready.

## 1. TUJUAN UTAMA

Aplikasi ini berfungsi sebagai API Gateway di antara user dan Mimo API.

Admin memasukkan satu atau beberapa API token/account Mimo ke gateway. Gateway harus dapat membaca informasi akun Mimo jika API Mimo menyediakan endpoint tersebut, seperti:

* Plan
* Total quota/token allowance
* Remaining quota
* Used quota
* Model yang tersedia
* Status token/account
* Reset date/period quota jika tersedia

Gateway kemudian memungkinkan admin membagi quota Mimo menjadi beberapa allocation/porsi untuk user.

Contoh:

Total quota Mimo:

6,000,000,000 tokens

Jika dibagi 2:

User A = 3,000,000,000
User B = 3,000,000,000

Jika dibagi 3:

User A = 2,000,000,000
User B = 2,000,000,000
User C = 2,000,000,000

Jika User B menghabiskan seluruh allocation-nya, User B harus ditolak meskipun masih ada quota pada user lain.

Jangan menggunakan shared unlimited pool kecuali admin secara eksplisit mengaktifkan mode tersebut.

---

# 2. TECH STACK

Gunakan:

Frontend:

* React
* Vite
* TypeScript
* Tailwind CSS
* TanStack Query
* React Router
* Recharts untuk chart

Backend:

* Node.js
* TypeScript
* Fastify
* Zod
* Drizzle ORM

Database:

* PostgreSQL

Performance/state:

* Redis

Deployment:

* Docker
* Docker Compose
* Caddy atau Nginx sebagai reverse proxy

Authentication:

* Admin authentication
* User authentication
* Secure API Keys untuk gateway
* Password hashing menggunakan Argon2id

API:

* OpenAI-compatible API format

Jangan gunakan microservices. Buat modular monolith terlebih dahulu agar mudah di-deploy dan dipelihara.

---

# 3. DESAIN UI

Gunakan **Neo-Brutalism** sebagai design system utama.

Jangan menggunakan:

* Glassmorphism
* Excessive gradients
* Soft shadows
* Blur-heavy UI
* Generic modern SaaS template
* Excessive rounded cards

Gunakan:

* Thick black borders 3-4px
* Hard shadows tanpa blur
* Solid/high-contrast colors
* Bold typography
* Slightly rounded corners
* Large chunky buttons
* Cards seperti blok fisik
* Strong visual hierarchy
* Hover animation
* Press animation
* Clear status badges

Contoh:

```css
border: 4px solid #111;
box-shadow: 6px 6px 0 #111;
```

Button:

```css
border: 3px solid #111;
box-shadow: 4px 4px 0 #111;
```

Saat ditekan:

```css
transform: translate(4px, 4px);
box-shadow: 0 0 0 #111;
```

Gunakan palette:

```text
Background: #F5F0E8
Black:      #111111
White:      #FFFFFF
Yellow:     #FFD43B
Purple:     #A78BFA
Green:      #7CFF6B
Red:        #FF6B6B
Blue:       #6CB6FF
```

UI harus terasa seperti **developer tool + fintech dashboard + Neo-Brutalist SaaS**.

Responsive:

* Desktop
* Tablet
* Mobile

Mobile UI harus benar-benar usable, bukan sekadar mengecilkan desktop layout.

---

# 4. FRONTEND PAGES

Buat halaman:

## Landing/Login

* Logo
* Product name
* Short description
* Login
* Register jika diperlukan
* Neo-brutalist visual

## Dashboard

Tampilkan:

* Mimo plan
* Total quota
* Used quota
* Remaining quota
* Number of users
* Number of API requests
* Token usage hari ini
* Token usage bulan ini
* System status
* Mimo connection status

Buat quota visualization:

```text
TOTAL QUOTA
6,000,000,000

USED
1,700,000,000

REMAINING
4,300,000,000

USAGE
████████░░░░░░░░ 28%
```

## Users

Table:

* Username
* Email
* API key status
* Allocation
* Used
* Remaining
* Usage %
* Status
* Last request
* Actions

Actions:

* Create user
* Edit user
* Disable
* Reset API key
* Change allocation
* View usage

## Allocation

Ini adalah salah satu halaman utama.

Admin dapat memilih:

```text
Total quota: 6,000,000,000

Split:
[ 2 ] Users

Allocation:
User A → 3,000,000,000
User B → 3,000,000,000
```

atau:

```text
Split:
[ 3 ] Users

User A → 2B
User B → 2B
User C → 2B
```

Support juga custom allocation:

```text
User A → 1B
User B → 2B
User C → 3B
```

Validasi:

```text
SUM(allocation) <= total_allocatable_quota
```

Gunakan rumus:

$$
A_{total} = \sum_{i=1}^{n} A_i
$$

dan pastikan:

$$
A_{total} \le Q_{available}
$$

## Mimo Accounts

Admin dapat:

* Add Mimo API token
* Remove token
* Test token
* Refresh account information
* View plan
* View quota
* View usage
* View available models
* View token status

API token Mimo harus **dienkripsi saat disimpan**.

Jangan pernah menampilkan full token di frontend.

Gunakan masked format:

```text
mimo_xxxxxxxx••••••••91ab
```

## Usage

Tampilkan:

* Requests
* Input tokens
* Output tokens
* Total tokens
* Cost jika tersedia
* User
* Model
* Timestamp
* Request duration
* HTTP status

Filter:

* Today
* 7 days
* 30 days
* Custom range
* User
* Model

Tambahkan charts.

## API Keys

User dapat:

* View masked API key
* Create API key
* Revoke API key
* Rotate API key

Format:

```text
gw_live_xxxxxxxxxxxxxxxxx
```

Simpan hanya hash API key di database jika memungkinkan.

## Settings

* Gateway URL
* Default model
* Rate limits
* Quota behavior
* Mimo sync interval
* Logging
* Security
* Admin settings

---

# 5. USER DASHBOARD

User biasa tidak boleh mengakses admin features.

User dashboard:

```text
MY ALLOCATION

2,000,000,000 TOKENS

USED
743,291,221

REMAINING
1,256,708,779

63% REMAINING
```

Tampilkan:

* API key
* Allocation
* Used
* Remaining
* Usage history
* Request count
* Available models
* API documentation
* Recent requests

Jika quota habis:

```text
QUOTA EXHAUSTED

0 TOKENS REMAINING

API ACCESS LOCKED
```

Semua API request user harus ditolak dengan HTTP status yang jelas.

---

# 6. GATEWAY API

Buat OpenAI-compatible endpoint:

```http
POST /v1/chat/completions
Authorization: Bearer gw_live_xxxxxxxxx
Content-Type: application/json
```

Request:

```json
{
  "model": "mimo-v2",
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ],
  "stream": true
}
```

Gateway harus:

1. Validasi API key
2. Cari user
3. Cek user aktif
4. Cek allocation
5. Cek rate limit
6. Reserve estimated quota
7. Forward request ke Mimo
8. Support streaming
9. Parse usage dari response jika tersedia
10. Commit actual usage
11. Refund unused reservation jika diperlukan
12. Simpan usage log
13. Return response ke client

---

# 7. QUOTA SYSTEM

Ini bagian paling penting.

Jangan hanya melakukan:

```text
SELECT remaining
UPDATE remaining
```

karena dapat menyebabkan race condition.

Gunakan Redis atomic operation / transaction / database locking.

Contoh:

User memiliki:

```text
Remaining = 10,000
```

Request A:

```text
8,000 tokens
```

Request B:

```text
8,000 tokens
```

Keduanya datang bersamaan.

Gateway harus memastikan:

$$
8,000 + 8,000 > 10,000
$$

Sehingga salah satu request harus ditolak atau menunggu.

Tidak boleh terjadi:

```text
A sees 10,000
B sees 10,000

A accepted
B accepted

Final usage = 16,000
Remaining = -6,000
```

Remaining tidak boleh menjadi negatif.

Gunakan konsep:

```text
reserve()
→ request()
→ finalize()
```

Jika request gagal:

```text
release reservation
```

Jika berhasil:

```text
commit actual usage
```

---

# 8. TOKEN ACCOUNTING

Prioritaskan token usage resmi dari response Mimo jika tersedia.

Misalnya:

```json
{
  "usage": {
    "prompt_tokens": 1200,
    "completion_tokens": 800,
    "total_tokens": 2000
  }
}
```

Gunakan:

$$
T_{total}=T_{input}+T_{output}
$$

Jika Mimo tidak mengembalikan usage, buat fallback estimation berdasarkan tokenizer yang sesuai jika tersedia.

Tandai usage sebagai:

```text
official
```

atau:

```text
estimated
```

Jangan mencampur keduanya tanpa penanda.

---

# 9. QUOTA RECONCILIATION

Jika Mimo menyediakan official usage/quota endpoint, buat background synchronization.

Contoh:

```text
Every 1-5 minutes:

Gateway
   ↓
Mimo quota endpoint
   ↓
Fetch official usage
   ↓
Compare local usage
   ↓
Detect discrepancy
   ↓
Update sync status
```

Tampilkan:

```text
LOCAL USAGE
1,700,000,000

MIMO OFFICIAL USAGE
1,702,381,221

DIFFERENCE
2,381,221
```

Jangan diam-diam menghapus data lokal. Simpan reconciliation history.

---

# 10. DATABASE

Gunakan PostgreSQL.

Minimal tables:

```text
users
admin_users
api_keys
mimo_accounts
mimo_models
allocations
usage_logs
request_logs
quota_reservations
quota_snapshots
reconciliation_logs
rate_limits
audit_logs
system_settings
```

Relasi harus jelas.

Contoh:

```text
User
 ├── API Keys
 ├── Allocation
 ├── Usage Logs
 └── Request Logs

Mimo Account
 ├── Models
 ├── Quota Snapshots
 └── Reconciliation Logs
```

Gunakan database migrations.

---

# 11. SECURITY

Wajib implement:

* Argon2id password hashing
* API key hashing
* Encryption at rest untuk Mimo token
* HTTPS
* CORS configuration
* Rate limiting
* Request body limits
* Input validation dengan Zod
* SQL injection protection melalui ORM
* Audit logs
* Secure HTTP headers
* Admin RBAC
* User isolation
* Secret management melalui environment variables

Jangan pernah:

```text
console.log(mimoApiToken)
```

Jangan pernah mengirim Mimo API token ke frontend.

Jangan pernah menyimpan raw gateway API key jika hash cukup.

---

# 12. RATE LIMITING

Buat rate limit per user.

Contoh:

```text
60 requests/minute
```

Admin dapat mengubah:

```text
requests_per_minute
requests_per_hour
```

Gunakan Redis sliding window/token bucket.

Response:

```http
429 Too Many Requests
```

dengan format error JSON yang konsisten.

---

# 13. ERROR FORMAT

Gunakan format:

```json
{
  "error": {
    "message": "Quota exhausted",
    "type": "quota_exceeded",
    "code": "QUOTA_EXCEEDED"
  }
}
```

Possible codes:

```text
INVALID_API_KEY
USER_DISABLED
QUOTA_EXCEEDED
RATE_LIMITED
MIMO_UNAVAILABLE
MIMO_AUTH_ERROR
MODEL_NOT_FOUND
UPSTREAM_ERROR
REQUEST_TIMEOUT
```

---

# 14. STREAMING

Support:

```text
stream: true
```

Gunakan SSE dan pastikan stream Mimo diteruskan dengan benar ke client.

Jangan menunggu seluruh completion jika streaming diaktifkan.

Usage akhir tetap harus dicatat setelah stream selesai.

Jika stream terputus, tangani partial usage dengan benar.

---

# 15. MODEL ROUTING

Buat provider abstraction:

```text
AIProvider
├── getAccount()
├── getPlan()
├── getQuota()
├── getUsage()
├── getModels()
└── chat()
```

Implementasi awal:

```text
MimoProvider
```

Tetapi architecture harus memungkinkan:

```text
OpenAIProvider
GeminiProvider
AnthropicProvider
```

di masa depan.

Jangan hardcode semua logic Mimo di route handler.

---

# 16. ADMIN FEATURES

Admin dapat:

* Add/remove Mimo account
* Test connection
* Sync quota
* Create users
* Disable users
* Reset API keys
* Set allocation
* Rebalance allocation
* Set rate limits
* View usage
* View requests
* View errors
* View reconciliation
* Manage models
* Configure gateway

Saat allocation diubah, jangan langsung menghapus historical usage.

Simpan:

```text
allocation_history
```

agar histori tetap akurat.

---

# 17. AUDIT LOG

Catat event penting:

```text
USER_CREATED
USER_DISABLED
API_KEY_CREATED
API_KEY_REVOKED
ALLOCATION_CHANGED
MIMO_TOKEN_ADDED
MIMO_TOKEN_REMOVED
QUOTA_SYNCED
ADMIN_LOGIN
SETTINGS_CHANGED
```

Simpan:

```text
actor
action
target
metadata
timestamp
IP
```

---

# 18. DOCKER

Buat:

```text
docker-compose.yml
```

services:

```text
frontend
backend
postgres
redis
caddy
```

Environment variables:

```env
DATABASE_URL=
REDIS_URL=

JWT_SECRET=
ENCRYPTION_KEY=

MIMO_API_URL=
MIMO_API_TOKEN=

CORS_ORIGIN=
```

Jangan commit `.env`.

Buat:

```text
.env.example
```

---

# 19. API DOCUMENTATION

Buat dokumentasi endpoint:

```text
POST /v1/chat/completions

GET /v1/models

GET /api/dashboard
GET /api/users
GET /api/usage
GET /api/allocation
GET /api/mimo/accounts
POST /api/mimo/accounts
POST /api/mimo/accounts/:id/sync
POST /api/users
PATCH /api/users/:id
POST /api/users/:id/api-key
DELETE /api/users/:id/api-key
```

Gunakan OpenAPI/Swagger untuk backend documentation.

---

# 20. IMPORTANT BEHAVIOR

Jika total Mimo quota:

```text
6B
```

dan allocation:

```text
A = 3B
B = 3B
```

A menggunakan 3B:

```text
A = LOCKED
B = masih memiliki 3B
```

Jangan memindahkan quota A ke B secara otomatis.

Jika admin melakukan rebalance secara manual, buat confirmation step dan audit log.

---

# 21. UI STATUS

Gunakan status visual yang sangat jelas:

```text
● ONLINE
● SYNCED
● ACTIVE
● HEALTHY
```

Warnings:

```text
⚠ LOW QUOTA
⚠ SYNC DELAYED
⚠ UPSTREAM ERROR
```

Critical:

```text
✕ QUOTA EXHAUSTED
✕ TOKEN INVALID
✕ ACCOUNT DISABLED
```

---

# 22. PERFORMANCE

Target:

* Low latency gateway overhead
* Connection pooling
* Redis caching
* Keep-alive HTTP connections
* Streaming support
* Async logging
* Background quota synchronization
* Efficient PostgreSQL indexes

Jangan melakukan query PostgreSQL berulang kali untuk setiap token counter jika dapat ditangani Redis.

---

# 23. TESTING

Buat tests untuk:

### Unit

* Allocation calculation
* Quota calculation
* Token accounting
* API key validation
* Rate limiting

### Integration

* User request
* Quota reservation
* Quota exhaustion
* Concurrent requests
* Mimo error
* Streaming
* API key revoke

### Critical concurrency test

Simulasikan:

```text
Remaining = 1000

Request A = 700
Request B = 700
```

Expected:

```text
Only one request succeeds
Remaining never < 0
```

---

# 24. PROJECT QUALITY

Jangan hanya membuat prototype visual.

Implementasikan:

* Real database
* Real authentication
* Real API gateway
* Real Redis quota locking
* Real usage tracking
* Real Mimo integration abstraction
* Real error handling
* Real migrations
* Real Docker setup

Tetapi jangan mengarang endpoint Mimo.

Jika dokumentasi/API Mimo tidak diketahui atau endpoint quota tidak tersedia, buat adapter/interface yang jelas dan tandai bagian tersebut sebagai configuration/integration point daripada mengarang endpoint palsu.

---

# 25. FINAL UX

Produk harus terasa seperti:

**"Stripe Dashboard × Developer API Platform × Neo-Brutalism"**

bukan seperti:

**"Admin panel CRUD template tahun 2016."**

Prioritaskan:

1. Quota visibility
2. API usability
3. Allocation correctness
4. Security
5. Performance
6. Clean Neo-Brutalist UI

Mulai dari architecture dan database schema, lalu implement backend gateway, kemudian frontend dashboard.

Setelah selesai, jalankan lint, typecheck, migration validation, unit tests, integration tests, dan build production. Perbaiki seluruh error sebelum menyatakan proyek selesai.
