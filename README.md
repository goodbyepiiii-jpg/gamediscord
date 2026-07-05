# 🃏 Bot Xì Dách Discord

Bot chơi Xì Dách (Blackjack) trên Discord với đầy đủ tính năng: phòng chờ, đặt cược, ẩn bài, xem bài, rút thêm.

## Tính năng

| Tính năng | Mô tả |
|---|---|
| 🏠 Phòng chờ | Mở phòng, chọn Bắt đầu hoặc Huỷ |
| 💰 Đặt cược | Chọn mức cược: 100 / 500 / 1,000 / 5,000 / 10,000 coins |
| 🂠 Ẩn bài | Bài bot luôn ẩn lá thứ 2 trong khi chơi |
| 👁️ Xem bài | Nút xem bài của mình (chỉ mình thấy) |
| 🃏 Rút thêm | Rút thêm bài |
| ✋ Dừng | Bot tự động rút đến ≥ 17, rồi so kết quả |
| ✨ Blackjack | Thắng ngay với 2 lá đầu = 21, nhận 1.5× cược |
| 🏦 Số dư | Mỗi người bắt đầu với 1,000 coins |

## Cài đặt

### 1. Cài Node.js (18+) và clone repo

```bash
git clone https://github.com/goodbyepiiii-jpg/gamediscord.git
cd gamediscord
npm install
```

### 2. Tạo bot trên Discord Developer Portal

1. Vào https://discord.com/developers/applications
2. Nhấn **New Application**, đặt tên
3. Vào tab **Bot** → **Reset Token** → copy token
4. Vào tab **OAuth2** → **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`
5. Mời bot vào server bằng URL sinh ra

### 3. Cấu hình biến môi trường

```bash
cp .env.example .env
```

Mở file `.env` và điền:

```env
DISCORD_TOKEN=token_bot_của_bạn
CLIENT_ID=application_id_của_bạn
```

> **CLIENT_ID** lấy ở tab **General Information** → **Application ID**

### 4. Đăng ký slash command

```bash
npm run deploy
```

Chỉ cần chạy **một lần** (hoặc khi đổi tên/mô tả command).

### 5. Khởi động bot

```bash
npm start
```

## Cách chơi

1. Gõ `/xidach` trong server Discord
2. Nhấn **▶️ Bắt đầu**
3. Chọn mức cược
4. Dùng các nút:
   - **👁️ Xem bài** — xem bài của mình (chỉ mình thấy)
   - **🃏 Rút thêm** — rút thêm 1 lá bài
   - **✋ Dừng** — kết thúc lượt, bot sẽ rút bài và so kết quả

## Luật chơi

- Bộ bài 52 lá chuẩn (A, 2-10, J, Q, K)
- A = 11 điểm (tự động xuống 1 nếu quắc)
- J, Q, K = 10 điểm
- Bot luôn rút bài khi tổng < 17
- **Blackjack** (A + lá 10 điểm ngay từ đầu) = thắng 1.5× cược
- Quắc (tổng > 21) = thua ngay
- Chỉ người tạo game mới bấm được nút (người khác sẽ bị báo lỗi)
