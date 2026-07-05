/**
 * Bot Xì Dách (Blackjack) Discord — v2.2
 * Features: lobby, cược, ẩn bài, xem bài, rút thêm, dừng
 * Fixes: crash prevention, error handling, reconnect
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
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.message ?? err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message ?? err);
  // Không exit — bot tiếp tục chạy
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── Storage ───────────────────────────────────────────────────────────────
const games    = new Map(); // userId → game state
const balances = new Map(); // userId → coins

// ─── Card helpers ──────────────────────────────────────────────────────────
const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ suit, rank });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardStr(card) {
  return `\`${card.rank}${card.suit}\``;
}

function handValue(cards) {
  let value = 0, aces = 0;
  for (const c of cards) {
    if (['J','Q','K'].includes(c.rank)) value += 10;
    else if (c.rank === 'A') { value += 11; aces++; }
    else value += parseInt(c.rank);
  }
  while (value > 21 && aces > 0) { value -= 10; aces--; }
  return value;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

// ─── Balance helpers ───────────────────────────────────────────────────────
function getBalance(userId) {
  if (!balances.has(userId)) balances.set(userId, 1000);
  return balances.get(userId);
}
function addBalance(userId, delta) {
  balances.set(userId, Math.max(0, getBalance(userId) + delta));
}

// ─── Race-condition guard ──────────────────────────────────────────────────
function acquireResolveLock(userId) {
  const game = games.get(userId);
  if (!game || game.phase !== 'playing') return false;
  game.phase = 'resolving';
  return true;
}

// ─── Owner in customId ────────────────────────────────────────────────────
const SEP = '_';
function makeId(action, userId, extra) {
  return extra !== undefined
    ? `bj${SEP}${action}${SEP}${extra}${SEP}${userId}`
    : `bj${SEP}${action}${SEP}${userId}`;
}
function parseId(customId) {
  if (!customId.startsWith('bj_')) return null;
  const parts = customId.split(SEP);
  const action = parts[1];
  if (!action) return null;
  if (action === 'bet') return { action, extra: parts[2], ownerId: parts[3] };
  return { action, ownerId: parts[2] };
}

// ─── Embeds ────────────────────────────────────────────────────────────────
function lobbyEmbed(user) {
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Phòng chờ')
    .setDescription(
      `**${user.username}** mở phòng Xì Dách!\n\n` +
      `💰 Số dư: **${getBalance(user.id).toLocaleString()}** coins\n\n` +
      `Nhấn **Bắt đầu** để vào game hoặc **Huỷ** để đóng phòng.`
    )
    .setColor(0x5865F2)
    .setTimestamp();
}

function betEmbed(user) {
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Chọn cược')
    .setDescription(
      `💰 Số dư: **${getBalance(user.id).toLocaleString()}** coins\n\n` +
      `Chọn mức cược bên dưới:`
    )
    .setColor(0xFEE75C);
}

function gameEmbed(game) {
  const pVal  = handValue(game.playerCards);
  const pHand = game.playerCards.map(cardStr).join(' ');
  const bFirst = cardStr(game.botCards[0]);
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Đang chơi')
    .setColor(0x2B2D31)
    .addFields(
      { name: '👤 Bài của bạn', value: `${pHand}\n> **Tổng: ${pVal}**`, inline: true },
      { name: '🤖 Bài của Bot',  value: `${bFirst} \`🂠\`\n> **Tổng: ?**`, inline: true },
    )
    .addFields({ name: '💰 Cược', value: `**${game.bet.toLocaleString()}** coins`, inline: false })
    .setFooter({ text: '👁️ Xem bài để kiểm tra lá bài của bạn (chỉ mình thấy).' });
}

function resultEmbed(game, result, payout) {
  const pVal  = handValue(game.playerCards);
  const bVal  = handValue(game.botCards);
  const pHand = game.playerCards.map(cardStr).join(' ');
  const bHand = game.botCards.map(cardStr).join(' ');
  const colorMap = { win:0x57F287, blackjack:0x57F287, botbust:0x57F287, lose:0xED4245, bust:0xED4245, dealerbj:0xED4245, tie:0x808080 };
  const textMap  = {
    blackjack: `✨ **BLACKJACK! Bạn thắng!** +${payout.toLocaleString()} coins`,
    win:       `🏆 **Bạn thắng!** +${payout.toLocaleString()} coins`,
    botbust:   `🎉 **Bot quắc! Bạn thắng!** +${payout.toLocaleString()} coins`,
    lose:      `😢 **Bạn thua!** -${game.bet.toLocaleString()} coins`,
    bust:      `💥 **Quắc! Thua rồi.** -${game.bet.toLocaleString()} coins`,
    dealerbj:  `🃏 **Bot Blackjack! Bạn thua!** -${game.bet.toLocaleString()} coins`,
    tie:       `🤝 **Hòa!** Hoàn trả ${game.bet.toLocaleString()} coins`,
  };
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Kết quả')
    .setColor(colorMap[result] ?? 0x808080)
    .addFields(
      { name: '👤 Bạn', value: `${pHand}\n> **Tổng: ${pVal}**`, inline: true },
      { name: '🤖 Bot', value: `${bHand}\n> **Tổng: ${bVal}**`, inline: true },
    )
    .addFields(
      { name: '💰 Cược',     value: `${game.bet.toLocaleString()} coins`,                    inline: true  },
      { name: '📊 Kết quả', value: textMap[result] ?? '—',                                   inline: false },
      { name: '🏦 Số dư',   value: `**${getBalance(game.ownerId).toLocaleString()}** coins`, inline: true  },
    )
    .setTimestamp();
}

// ─── Button rows ───────────────────────────────────────────────────────────
const BETS = [100, 500, 1000, 5000, 10000];

function lobbyRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(makeId('start',  userId)).setLabel('▶️ Bắt đầu').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(makeId('cancel', userId)).setLabel('❌ Huỷ'    ).setStyle(ButtonStyle.Danger),
  );
}
function betRows(userId) {
  const bal  = getBalance(userId);
  const btns = BETS.map(b =>
    new ButtonBuilder()
      .setCustomId(makeId('bet', userId, b))
      .setLabel(b.toLocaleString())
      .setStyle(ButtonStyle.Primary)
      .setDisabled(bal < b)
  );
  return [
    new ActionRowBuilder().addComponents(...btns),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(makeId('cancel', userId)).setLabel('❌ Huỷ').setStyle(ButtonStyle.Danger)
    ),
  ];
}
function gameRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(makeId('view',  userId)).setLabel('👁️ Xem bài' ).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(makeId('hit',   userId)).setLabel('🃏 Rút thêm').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(makeId('stand', userId)).setLabel('✋ Dừng'    ).setStyle(ButtonStyle.Success),
  );
}

// ─── Result helpers ────────────────────────────────────────────────────────
function applyResult(userId, result, bet, payout) {
  if (['win','blackjack','botbust'].includes(result)) addBalance(userId, payout);
  else if (['lose','bust','dealerbj'].includes(result)) addBalance(userId, -bet);
}

function resolveGame(game) {
  const pVal = handValue(game.playerCards);
  while (handValue(game.botCards) < 17) game.botCards.push(game.deck.pop());
  const bVal = handValue(game.botCards);
  if (bVal > 21)        return { result: 'botbust', payout: game.bet };
  if (pVal > bVal)      return { result: 'win',     payout: game.bet };
  if (pVal < bVal)      return { result: 'lose',    payout: 0 };
  return { result: 'tie', payout: 0 };
}

// ─── Safe reply helper ─────────────────────────────────────────────────────
// Tránh crash khi interaction đã expired hoặc đã được reply rồi
async function safeUpdate(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.update(payload);
    }
  } catch (err) {
    console.error('[safeUpdate]', err?.message ?? err);
  }
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied) {
      await interaction.followUp({ ...payload, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    console.error('[safeReply]', err?.message ?? err);
  }
}

// ─── Event handler ─────────────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
  console.log(`✅ Đã đăng nhập: ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Bọc toàn bộ trong try/catch — không bao giờ crash process
  try {
    await handleInteraction(interaction);
  } catch (err) {
    console.error('[InteractionCreate]', err?.message ?? err);
    // Cố trả lỗi về user nhưng không crash nếu thất bại
    try {
      const msg = { content: '❌ Có lỗi xảy ra, thử lại sau.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    } catch (_) {}
  }
});

async function handleInteraction(interaction) {
  // ── /xidach ──────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'xidach') {
    games.delete(interaction.user.id);
    await interaction.reply({
      embeds:     [lobbyEmbed(interaction.user)],
      components: [lobbyRow(interaction.user.id)],
    });
    return;
  }

  if (!interaction.isButton()) return;

  const parsed = parseId(interaction.customId);
  if (!parsed) return;

  const { action, ownerId, extra } = parsed;
  const userId = interaction.user.id;

  // ── Owner check ──────────────────────────────────────────────────────────
  if (ownerId && ownerId !== userId) {
    return safeReply(interaction, { content: '❌ Đây không phải game của bạn!', ephemeral: true });
  }

  // ── Bắt đầu ──────────────────────────────────────────────────────────────
  if (action === 'start') {
    return safeUpdate(interaction, {
      embeds:     [betEmbed(interaction.user)],
      components: betRows(userId),
    });
  }

  // ── Huỷ ──────────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    games.delete(userId);
    return safeUpdate(interaction, {
      embeds:     [new EmbedBuilder().setTitle('🃏 Xì Dách').setDescription('Đã huỷ phòng.').setColor(0x808080)],
      components: [],
    });
  }

  // ── Đặt cược ─────────────────────────────────────────────────────────────
  if (action === 'bet') {
    const bet = parseInt(extra, 10);
    const bal = getBalance(userId);
    if (isNaN(bet) || bal < bet) {
      return safeReply(interaction, { content: '❌ Số dư không đủ!', ephemeral: true });
    }

    const deck        = createDeck();
    const playerCards = [deck.pop(), deck.pop()];
    const botCards    = [deck.pop(), deck.pop()];
    const game        = { phase: 'playing', ownerId: userId, bet, deck, playerCards, botCards };
    games.set(userId, game);

    const playerBJ = isBlackjack(playerCards);
    const botBJ    = isBlackjack(botCards);

    if (playerBJ && botBJ) {
      games.delete(userId);
      return safeUpdate(interaction, { embeds: [resultEmbed(game, 'tie', 0)], components: [] });
    }
    if (playerBJ) {
      const payout = Math.floor(bet * 1.5);
      addBalance(userId, payout);
      games.delete(userId);
      return safeUpdate(interaction, { embeds: [resultEmbed(game, 'blackjack', payout)], components: [] });
    }
    if (botBJ) {
      addBalance(userId, -bet);
      games.delete(userId);
      return safeUpdate(interaction, { embeds: [resultEmbed(game, 'dealerbj', 0)], components: [] });
    }

    return safeUpdate(interaction, { embeds: [gameEmbed(game)], components: [gameRow(userId)] });
  }

  // ── Xem bài ──────────────────────────────────────────────────────────────
  if (action === 'view') {
    const game = games.get(userId);
    if (!game || game.phase === 'resolving') {
      return safeReply(interaction, { content: '❌ Không có game đang chạy.', ephemeral: true });
    }
    return safeReply(interaction, {
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle('👁️ Bài của bạn')
          .setColor(0x5865F2)
          .addFields(
            { name: '🃏 Lá bài',    value: game.playerCards.map(cardStr).join(' '), inline: true },
            { name: '📊 Tổng điểm', value: `**${handValue(game.playerCards)}**`,   inline: true },
            { name: '🤖 Lá lộ Bot', value: cardStr(game.botCards[0]),               inline: false },
          )
          .setFooter({ text: 'Chỉ mình bạn thấy tin nhắn này.' }),
      ],
    });
  }

  // ── Rút thêm ─────────────────────────────────────────────────────────────
  if (action === 'hit') {
    if (!acquireResolveLock(userId)) {
      return safeReply(interaction, { content: '⏳ Đang xử lý...', ephemeral: true });
    }
    const game = games.get(userId);
    game.playerCards.push(game.deck.pop());
    const pVal = handValue(game.playerCards);

    if (pVal > 21) {
      applyResult(userId, 'bust', game.bet, 0);
      games.delete(userId);
      return safeUpdate(interaction, { embeds: [resultEmbed(game, 'bust', 0)], components: [] });
    }
    if (pVal === 21) {
      const { result, payout } = resolveGame(game);
      applyResult(userId, result, game.bet, payout);
      games.delete(userId);
      return safeUpdate(interaction, { embeds: [resultEmbed(game, result, payout)], components: [] });
    }

    game.phase = 'playing';
    return safeUpdate(interaction, { embeds: [gameEmbed(game)], components: [gameRow(userId)] });
  }

  // ── Dừng ─────────────────────────────────────────────────────────────────
  if (action === 'stand') {
    if (!acquireResolveLock(userId)) {
      return safeReply(interaction, { content: '⏳ Đang xử lý...', ephemeral: true });
    }
    const game = games.get(userId);
    const { result, payout } = resolveGame(game);
    applyResult(userId, result, game.bet, payout);
    games.delete(userId);
    return safeUpdate(interaction, { embeds: [resultEmbed(game, result, payout)], components: [] });
  }
}

// ─── Login ─────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ Thiếu DISCORD_TOKEN. Đặt biến môi trường trước khi chạy.');
  process.exit(1);
}
client.login(token);
