/**
 * deploy-commands.js
 * Đăng ký slash command /xidach lên Discord (global).
 * Đồng thời xóa toàn bộ guild commands cũ nếu có GUILD_ID.
 *
 * Cách dùng:
 *   DISCORD_TOKEN=xxx CLIENT_ID=yyy node deploy-commands.js
 *   DISCORD_TOKEN=xxx CLIENT_ID=yyy GUILD_ID=zzz node deploy-commands.js
 */

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token    = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId  = process.env.GUILD_ID;

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
    // 1. Đăng ký global commands
    console.log('⏳ Đang đăng ký global slash commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Đăng ký global thành công!');

    // 2. Xóa guild commands cũ (nếu có GUILD_ID)
    if (guildId) {
      console.log(`⏳ Đang xóa guild commands cũ trong server ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      console.log('✅ Đã xóa toàn bộ guild commands cũ.');
    }
  } catch (err) {
    console.error('❌ Lỗi:', err.message);
  }
})();
