/**
 * Bot Xì Dách Nhiều Người (Multiplayer Blackjack) — v3.0
 * - Tối đa 6 người / phòng
 * - Bài ẩn hoàn toàn cho đến khi kết thúc
 * - Mỗi người tự xem bài riêng qua nút "Xem bài" (ephemeral)
 * - Lượt chơi tuần tự: Rút thêm / Dằn / Bỏ lượt
 */

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  EmbedBuilder,
} = require('discord.js');

// ─── Crash prevention ──────────────────────────────────────────────────────
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err?.message ?? err));
process.on('uncaughtException',  err => console.error('[uncaughtException]',  err?.message ?? err));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── Storage ───────────────────────────────────────────────────────────────
const rooms    = new Map(); // channelId → room
const balances = new Map(); // userId → coins

// ─── Card helpers ──────────────────────────────────────────────────────────
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const BETS  = [100, 500, 1000, 5000, 10000];

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardStr(c)     { return `\`${c.rank}${c.suit}\``; }
function handStr(cards)  { return cards.map(cardStr).join(' '); }
const   HIDDEN = '`🂠`';

function handValue(cards) {
  let v = 0, aces = 0;
  for (const c of cards) {
    if (['J','Q','K'].includes(c.rank)) v += 10;
    else if (c.rank === 'A') { v += 11; aces++; }
    else v += parseInt(c.rank);
  }
  while (v > 21 && aces > 0) { v -= 10; aces--; }
  return v;
}

function isBlackjack(cards) { return cards.length === 2 && handValue(cards) === 21; }

// ─── Balance helpers ───────────────────────────────────────────────────────
function getBalance(uid) {
  if (!balances.has(uid)) balances.set(uid, 1000);
  return balances.get(uid);
}
function addBalance(uid, delta) {
  balances.set(uid, Math.max(0, getBalance(uid) + delta));
}

// ─── Room helpers ──────────────────────────────────────────────────────────
function getPlayer(room, uid) { return room.players.find(p => p.id === uid); }
function curBetter(room)       { return room.players[room.betIndex]; }
function curTurn(room)         { return room.players[room.turnIndex]; }

// ─── Embeds ────────────────────────────────────────────────────────────────
function lobbyEmbed(room) {
  const list = room.players.length === 0
    ? '_Chưa có ai_'
    : room.players.map((p, i) => `${i === 0 ? '👑' : '👤'} **${p.username}**`).join('\n');
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách Nhiều Người — Phòng chờ')
    .setDescription('Nhấn **Tham gia** để vào phòng!\n\n' + list)
    .setColor(0x5865F2)
    .setFooter({ text: `${room.players.length}/6 người · Host bấm Bắt đầu khi đủ` })
    .setTimestamp();
}

function bettingEmbed(room) {
  const bp    = curBetter(room);
  const lines = room.players.map((p, i) => {
    const mark    = i === room.betIndex ? '👉 ' : '   ';
    const betText = p.bet !== null ? `**${p.bet.toLocaleString()}** coins` : '_(đang chọn…)_';
    return `${mark}**${p.username}** — cược: ${betText} · 💰 ${getBalance(p.id).toLocaleString()}`;
  }).join('\n');
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Đặt cược')
    .setDescription(`**${bp.username}**, chọn mức cược của bạn:\n\n${lines}`)
    .setColor(0xFEE75C);
}

const STATUS_LABEL = {
  playing:   '⏳ Đang chờ',
  stand:     '✋ Đã dằn',
  bust:      '💥 Quắc',
  blackjack: '✨ Blackjack',
  fold:      '🚪 Bỏ lượt',
};

function gameEmbed(room) {
  const cur    = curTurn(room);
  const fields = room.players.map(p => {
    const hidden = Array(p.cards.length).fill(HIDDEN).join(' ');
    const status = p.id === cur?.id && p.status === 'playing'
      ? '👉 **Đến lượt bạn**'
      : STATUS_LABEL[p.status] ?? '';
    return {
      name:   (p.id === cur?.id ? '▶️ ' : '') + `${p.username} · 🎯 ${p.bet.toLocaleString()} coins`,
      value:  `${hidden}\n${status}`,
      inline: true,
    };
  });
  fields.push({
    name:   '🤖 Bot (Dealer)',
    value:  `${cardStr(room.dealerCards[0])} ${HIDDEN}`,
    inline: false,
  });
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Đang chơi')
    .setColor(0x2B2D31)
    .addFields(fields)
    .setFooter({ text: cur ? `Lượt của ${cur.username}` : '' });
}

function resultEmbed(room) {
  const dVal = handValue(room.dealerCards);
  const dBJ  = isBlackjack(room.dealerCards);

  const dealerField = {
    name:   `🤖 Bot (Dealer) · ${handStr(room.dealerCards)} (${dVal})`,
    value:  dBJ ? '✨ Blackjack!' : dVal > 21 ? '💥 Quắc!' : 'Dừng.',
    inline: false,
  };

  const playerFields = room.players.map(p => {
    const pVal = handValue(p.cards);
    const pBJ  = isBlackjack(p.cards);
    let outcome;
    if (p.status === 'bust' || p.status === 'fold') {
      outcome = `❌ ${p.status === 'fold' ? 'Bỏ lượt' : 'Quắc'} — Thua ${p.bet.toLocaleString()} coins`;
    } else if (pBJ && dBJ) {
      outcome = '🤝 Cả hai Blackjack — Hòa';
    } else if (pBJ) {
      const gain = Math.floor(p.bet * 1.5);
      outcome = `✨ Blackjack — Thắng ${gain.toLocaleString()} coins`;
    } else if (dBJ) {
      outcome = `❌ Bot Blackjack — Thua ${p.bet.toLocaleString()} coins`;
    } else if (dVal > 21) {
      outcome = `✅ Bot quắc — Thắng ${p.bet.toLocaleString()} coins`;
    } else if (pVal > dVal) {
      outcome = `✅ Thắng ${p.bet.toLocaleString()} coins`;
    } else if (pVal < dVal) {
      outcome = `❌ Thua ${p.bet.toLocaleString()} coins`;
    } else {
      outcome = '🤝 Hòa';
    }
    return {
      name:   `${p.username} · ${handStr(p.cards)} (${pVal})`,
      value:  `${outcome}\n💰 Còn lại: **${getBalance(p.id).toLocaleString()}** coins`,
      inline: false,
    };
  });

  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Kết quả')
    .setColor(0x57F287)
    .addFields(dealerField, ...playerFields)
    .setTimestamp();
}

// ─── Button rows ──────────────────────────────────────────────────────────
function lobbyRows(hostId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mp_join').setLabel('🙋 Tham gia').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mp_start_${hostId}`).setLabel('▶️ Bắt đầu').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mp_cancel_${hostId}`).setLabel('❌ Huỷ').setStyle(ButtonStyle.Danger),
  )];
}

function bettingRows(currentPlayerId) {
  const bal  = getBalance(currentPlayerId);
  const btns = BETS.map(b =>
    new ButtonBuilder()
      .setCustomId(`mp_bet_${b}_${currentPlayerId}`)
      .setLabel(b.toLocaleString())
      .setStyle(ButtonStyle.Primary)
      .setDisabled(bal < b)
  );
  return [
    new ActionRowBuilder().addComponents(...btns),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mp_view').setLabel('👁️ Xem bài').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function gameRows(currentPlayerId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mp_view').setLabel('👁️ Xem bài').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mp_hit_${currentPlayerId}`).setLabel('🃏 Rút thêm').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mp_stand_${currentPlayerId}`).setLabel('✋ Dằn').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mp_fold_${currentPlayerId}`).setLabel('🚪 Bỏ lượt').setStyle(ButtonStyle.Danger),
  )];
}

// ─── Resolve & payout ─────────────────────────────────────────────────────
function resolveRoom(room) {
  // Dealer draws until ≥ 17
  while (handValue(room.dealerCards) < 17) room.dealerCards.push(room.deck.pop());
  const dVal = handValue(room.dealerCards);
  const dBJ  = isBlackjack(room.dealerCards);

  for (const p of room.players) {
    if (p.status === 'bust' || p.status === 'fold') continue; // already deducted
    const pVal = handValue(p.cards);
    const pBJ  = isBlackjack(p.cards);
    if (pBJ && dBJ)     { /* hòa — không đổi */ }
    else if (pBJ)        { addBalance(p.id, Math.floor(p.bet * 1.5)); }
    else if (dBJ)        { addBalance(p.id, -p.bet); }
    else if (dVal > 21)  { addBalance(p.id,  p.bet); }
    else if (pVal > dVal){ addBalance(p.id,  p.bet); }
    else if (pVal < dVal){ addBalance(p.id, -p.bet); }
    // bằng nhau: hòa, không đổi
  }
}

// ─── Advance turn ─────────────────────────────────────────────────────────
async function advanceTurn(interaction, room) {
  room.turnIndex++;
  // Skip players who are done
  while (
    room.turnIndex < room.players.length &&
    room.players[room.turnIndex].status !== 'playing'
  ) { room.turnIndex++; }

  if (room.turnIndex >= room.players.length) {
    // All done → resolve
    resolveRoom(room);
    room.phase = 'done';
    rooms.delete(room.channelId);
    return safeUpdate(interaction, { embeds: [resultEmbed(room)], components: [] });
  }

  const cur = curTurn(room);
  // Auto-resolve blackjack (already detected at deal)
  if (cur.status === 'blackjack') return advanceTurn(interaction, room);

  return safeUpdate(interaction, { embeds: [gameEmbed(room)], components: gameRows(cur.id) });
}

// ─── Safe helpers ──────────────────────────────────────────────────────────
async function safeUpdate(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.update(payload);
  } catch (e) { console.error('[safeUpdate]', e?.message); }
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied) await interaction.followUp({ ...payload, ephemeral: true }).catch(() => {});
    else await interaction.reply(payload);
  } catch (e) { console.error('[safeReply]', e?.message); }
}

// ─── Interaction handler ──────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
  console.log(`✅ Đã đăng nhập: ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try { await handleInteraction(interaction); }
  catch (err) {
    console.error('[InteractionCreate]', err?.message ?? err);
    try {
      const msg = { content: '❌ Có lỗi xảy ra, thử lại sau.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    } catch (_) {}
  }
});

async function handleInteraction(interaction) {
  // ── /xidach ───────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'xidach') {
    const chId = interaction.channelId;
    if (rooms.has(chId)) {
      return safeReply(interaction, { content: '❌ Đã có phòng đang chạy trong kênh này!', ephemeral: true });
    }
    const room = {
      phase: 'lobby', hostId: interaction.user.id, channelId: chId,
      players: [], deck: [], dealerCards: [], betIndex: 0, turnIndex: 0,
    };
    rooms.set(chId, room);
    // Host tự động tham gia
    room.players.push({ id: interaction.user.id, username: interaction.user.username, bet: null, cards: [], status: 'waiting' });

    await interaction.reply({ embeds: [lobbyEmbed(room)], components: lobbyRows(interaction.user.id) });
    return;
  }

  if (!interaction.isButton()) return;

  const cid    = interaction.customId;
  const chId   = interaction.channelId;
  const userId = interaction.user.id;
  const room   = rooms.get(chId);

  // ── Tham gia ──────────────────────────────────────────────────────────────
  if (cid === 'mp_join') {
    if (!room || room.phase !== 'lobby')
      return safeReply(interaction, { content: '❌ Không có phòng chờ trong kênh này.', ephemeral: true });
    if (getPlayer(room, userId))
      return safeReply(interaction, { content: '❌ Bạn đã trong phòng rồi!', ephemeral: true });
    if (room.players.length >= 6)
      return safeReply(interaction, { content: '❌ Phòng đã đầy (6 người)!', ephemeral: true });

    room.players.push({ id: userId, username: interaction.user.username, bet: null, cards: [], status: 'waiting' });
    return safeUpdate(interaction, { embeds: [lobbyEmbed(room)], components: lobbyRows(room.hostId) });
  }

  // ── Bắt đầu ───────────────────────────────────────────────────────────────
  if (cid.startsWith('mp_start_')) {
    const hostId = cid.slice('mp_start_'.length);
    if (userId !== hostId)
      return safeReply(interaction, { content: '❌ Chỉ host mới được bắt đầu!', ephemeral: true });
    if (!room || room.phase !== 'lobby')
      return safeReply(interaction, { content: '❌ Không tìm thấy phòng.', ephemeral: true });
    if (room.players.length < 1)
      return safeReply(interaction, { content: '❌ Cần ít nhất 1 người chơi!', ephemeral: true });

    // Chia bài (ẩn hoàn toàn)
    room.deck = createDeck();
    for (const p of room.players) {
      p.cards  = [room.deck.pop(), room.deck.pop()];
      p.status = 'playing';
    }
    room.dealerCards = [room.deck.pop(), room.deck.pop()];
    room.phase    = 'betting';
    room.betIndex = 0;

    const bp = curBetter(room);
    return safeUpdate(interaction, { embeds: [bettingEmbed(room)], components: bettingRows(bp.id) });
  }

  // ── Huỷ phòng ─────────────────────────────────────────────────────────────
  if (cid.startsWith('mp_cancel_')) {
    const hostId = cid.slice('mp_cancel_'.length);
    if (userId !== hostId)
      return safeReply(interaction, { content: '❌ Chỉ host mới được huỷ!', ephemeral: true });
    rooms.delete(chId);
    return safeUpdate(interaction, {
      embeds: [new EmbedBuilder().setTitle('🃏 Xì Dách').setDescription('Phòng đã bị huỷ.').setColor(0x808080)],
      components: [],
    });
  }

  // ── Đặt cược ──────────────────────────────────────────────────────────────
  if (cid.startsWith('mp_bet_')) {
    if (!room || room.phase !== 'betting') return;
    const parts    = cid.split('_');  // mp, bet, <amount>, <playerId>
    const amount   = parseInt(parts[2], 10);
    const ownerId  = parts[3];

    if (userId !== ownerId)
      return safeReply(interaction, { content: '❌ Chưa đến lượt bạn đặt cược!', ephemeral: true });

    const bp = curBetter(room);
    if (bp.id !== userId)
      return safeReply(interaction, { content: '❌ Chưa đến lượt bạn!', ephemeral: true });
    if (getBalance(userId) < amount)
      return safeReply(interaction, { content: '❌ Số dư không đủ!', ephemeral: true });

    bp.bet = amount;

    // Đánh dấu blackjack ngay (lá đã được chia)
    if (isBlackjack(bp.cards)) bp.status = 'blackjack';

    room.betIndex++;
    if (room.betIndex >= room.players.length) {
      // Tất cả đã cược → bắt đầu lượt chơi
      room.phase     = 'playing';
      room.turnIndex = 0;

      // Bỏ qua người blackjack ngay lập tức
      while (
        room.turnIndex < room.players.length &&
        room.players[room.turnIndex].status !== 'playing'
      ) { room.turnIndex++; }

      if (room.turnIndex >= room.players.length) {
        // Tất cả blackjack → kết thúc luôn
        resolveRoom(room);
        room.phase = 'done';
        rooms.delete(chId);
        return safeUpdate(interaction, { embeds: [resultEmbed(room)], components: [] });
      }

      const cur = curTurn(room);
      return safeUpdate(interaction, { embeds: [gameEmbed(room)], components: gameRows(cur.id) });
    } else {
      const next = curBetter(room);
      return safeUpdate(interaction, { embeds: [bettingEmbed(room)], components: bettingRows(next.id) });
    }
  }

  // ── Xem bài (ephemeral, bất kỳ người chơi nào) ────────────────────────────
  if (cid === 'mp_view') {
    if (!room || !['betting','playing'].includes(room.phase))
      return safeReply(interaction, { content: '❌ Không có game đang chạy.', ephemeral: true });

    const p = getPlayer(room, userId);
    if (!p)
      return safeReply(interaction, { content: '❌ Bạn không ở trong game này.', ephemeral: true });

    const val = handValue(p.cards);
    return safeReply(interaction, {
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle('👁️ Bài của bạn — chỉ mình bạn thấy')
          .setColor(0x5865F2)
          .addFields(
            { name: '🃏 Lá bài',    value: handStr(p.cards) + (isBlackjack(p.cards) ? '  ✨ **BLACKJACK!**' : ''), inline: true },
            { name: '📊 Tổng điểm', value: `**${val}**`, inline: true },
            { name: '🤖 Lá lộ Bot', value: cardStr(room.dealerCards[0]), inline: false },
          )
          .setFooter({ text: 'Chỉ mình bạn thấy tin nhắn này.' }),
      ],
    });
  }

  // ── Rút thêm ──────────────────────────────────────────────────────────────
  if (cid.startsWith('mp_hit_')) {
    if (!room || room.phase !== 'playing') return;
    const ownerId = cid.slice('mp_hit_'.length);
    if (userId !== ownerId)
      return safeReply(interaction, { content: '❌ Chưa đến lượt bạn!', ephemeral: true });

    const cur = curTurn(room);
    if (!cur || cur.id !== userId || cur.status !== 'playing')
      return safeReply(interaction, { content: '❌ Chưa đến lượt bạn!', ephemeral: true });

    cur.cards.push(room.deck.pop());
    const val = handValue(cur.cards);

    if (val > 21) {
      cur.status = 'bust';
      addBalance(userId, -cur.bet);
      return advanceTurn(interaction, room);
    }
    if (val === 21) {
      cur.status = 'stand'; // tự động dằn khi đạt 21
      return advanceTurn(interaction, room);
    }

    return safeUpdate(interaction, { embeds: [gameEmbed(room)], components: gameRows(cur.id) });
  }

  // ── Dằn ───────────────────────────────────────────────────────────────────
  if (cid.startsWith('mp_stand_')) {
    if (!room || room.phase !== 'playing') return;
    const ownerId = cid.slice('mp_stand_'.length);
    if (userId !== ownerId)
      return safeReply(interaction, { content: '❌ Chưa đến lượt bạn!', ephemeral: true });

    const cur = curTurn(room);
    if (!cur || cur.id !== userId || cur.status !== 'playing') return;

    cur.status = 'stand';
    return advanceTurn(interaction, room);
  }

  // ── Bỏ lượt ───────────────────────────────────────────────────────────────
  if (cid.startsWith('mp_fold_')) {
    if (!room || room.phase !== 'playing') return;
    const ownerId = cid.slice('mp_fold_'.length);
    if (userId !== ownerId)
      return safeReply(interaction, { content: '❌ Chưa đến lượt bạn!', ephemeral: true });

    const cur = curTurn(room);
    if (!cur || cur.id !== userId || cur.status !== 'playing') return;

    cur.status = 'fold';
    addBalance(userId, -cur.bet);
    return advanceTurn(interaction, room);
  }
}

// ─── Login ─────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ Thiếu DISCORD_TOKEN. Đặt biến môi trường trước khi chạy.');
  process.exit(1);
}
client.login(token);
