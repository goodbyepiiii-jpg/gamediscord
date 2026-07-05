/**
 * deploy-commands.js
 * Chạy file này MỘT LẦN để đăng ký slash command /xidach lên Discord.
 * 
 * Cách dùng:
 *   DISCORD_TOKEN=xxx CLIENT_ID=yyy node deploy-commands.js
 */

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('❌ Cần đặt biến môi trường DISCORD_TOKEN và CLIENT_ID');
  console.error('   Ví dụ: DISCORD_TOKEN=abc CLIENT_ID=123 node deploy-commands.js');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('xidach')
    .setDescription('🃏 Chơi game Xì Dách (Blackjack) với cược coins')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('⏳ Đang đăng ký slash commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Đăng ký thành công! Slash command /xidach đã sẵn sàng.');
  } catch (err) {
    console.error('❌ Lỗi:', err.message);
  }
})();
