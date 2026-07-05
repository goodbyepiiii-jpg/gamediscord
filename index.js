/**
 * Bot Xì Dách (Blackjack) Discord
 * Features: lobby, cược, ẩn bài, xem bài, rút thêm, dừng
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
  // Fisher-Yates shuffle
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
function addBalance(userId, amount) {
  balances.set(userId, getBalance(userId) + amount);
}

// ─── Embeds ────────────────────────────────────────────────────────────────
function lobbyEmbed(user) {
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Phòng chờ')
    .setDescription(
      `**${user.username}** mở phòng Xì Dách!\n\n` +
      `💰 Số dư: **${getBalance(user.id).toLocaleString()}** coins\n\n` +
      `Nhấn **Bắt đầu** để vào game, **Huỷ** để đóng phòng.`
    )
    .setColor(0x5865F2)
    .setTimestamp();
}

function betEmbed(user) {
  const bal = getBalance(user.id);
  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Chọn cược')
    .setDescription(
      `💰 Số dư: **${bal.toLocaleString()}** coins\n\n` +
      `Chọn mức cược bên dưới:`
    )
    .setColor(0xFEE75C)
    .setFooter({ text: 'Mức cược tối đa là 50% số dư của bạn.' });
}

function gameEmbed(game) {
  const pVal  = handValue(game.playerCards);
  const pHand = game.playerCards.map(cardStr).join(' ');
  const bFirst = cardStr(game.botCards[0]);

  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Đang chơi')
    .setColor(0x2B2D31)
    .addFields(
      {
        name: '👤 Bài của bạn',
        value: `${pHand}\n> **Tổng: ${pVal}**`,
        inline: true,
      },
      {
        name: '🤖 Bài của Bot',
        value: `${bFirst} \`🂠\`\n> **Tổng: ?**`,
        inline: true,
      },
    )
    .addFields({
      name: '💰 Cược',
      value: `**${game.bet.toLocaleString()}** coins`,
      inline: false,
    })
    .setFooter({ text: '👁️ Xem bài để kiểm tra lá bài của bạn.' });
}

function resultEmbed(game, result, payout) {
  const pVal  = handValue(game.playerCards);
  const bVal  = handValue(game.botCards);
  const pHand = game.playerCards.map(cardStr).join(' ');
  const bHand = game.botCards.map(cardStr).join(' ');

  const colorMap = { win: 0x57F287, blackjack: 0x57F287, botbust: 0x57F287,
                     lose: 0xED4245, bust: 0xED4245, tie: 0x808080 };
  const textMap  = {
    blackjack: `✨ **BLACKJACK! Bạn thắng!** +${payout.toLocaleString()} coins`,
    win:       `🏆 **Bạn thắng!** +${payout.toLocaleString()} coins`,
    botbust:   `🎉 **Bot quắc! Bạn thắng!** +${payout.toLocaleString()} coins`,
    lose:      `😢 **Bạn thua!** -${game.bet.toLocaleString()} coins`,
    bust:      `💥 **Quắc! Thua rồi.** -${game.bet.toLocaleString()} coins`,
    tie:       `🤝 **Hòa!** Hoàn trả ${game.bet.toLocaleString()} coins`,
  };

  const newBal = getBalance(game.ownerId);

  return new EmbedBuilder()
    .setTitle('🃏 Xì Dách — Kết quả')
    .setColor(colorMap[result] ?? 0x808080)
    .addFields(
      { name: '👤 Bạn', value: `${pHand}\n> **Tổng: ${pVal}**`, inline: true },
      { name: '🤖 Bot', value: `${bHand}\n> **Tổng: ${bVal}**`, inline: true },
    )
    .addFields(
      { name: '💰 Cược', value: `${game.bet.toLocaleString()} coins`, inline: true },
      { name: '📊 Kết quả', value: textMap[result] ?? '—', inline: false },
      { name: '🏦 Số dư mới', value: `**${newBal.toLocaleString()}** coins`, inline: true },
    )
    .setTimestamp();
}

// ─── Button rows ───────────────────────────────────────────────────────────
function lobbyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_start' ).setLabel('▶️ Bắt đầu').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('bj_cancel').setLabel('❌ Huỷ'    ).setStyle(ButtonStyle.Danger),
  );
}

function betRow(userId) {
  const bal  = getBalance(userId);
  // Offer bet amounts; disable if not enough balance
  const BETS = [100, 500, 1000, 5000, 10000];
  const btns = BETS.map(b =>
    new ButtonBuilder()
      .setCustomId(`bj_bet_${b}`)
      .setLabel(`${b.toLocaleString()}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(bal < b)
  );
  // Split into two rows (Discord max 5 buttons/row)
  const row1 = new ActionRowBuilder().addComponents(...btns.slice(0, 5));
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_cancel').setLabel('❌ Huỷ').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

function gameRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj_view' ).setLabel('👁️ Xem bài' ).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bj_hit'  ).setLabel('🃏 Rút thêm').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('✋ Dừng'    ).setStyle(ButtonStyle.Success),
  );
}

// ─── Owner guard ───────────────────────────────────────────────────────────
/**
 * Returns the userId of whoever ran the original /xidach command.
 * interaction.message.interactionMetadata?.user is set by Discord when the
 * message is the reply to a slash command.
 */
function getMessageOwner(interaction) {
  return interaction.message?.interactionMetadata?.user?.id ?? null;
}

// ─── Event handler ─────────────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
  console.log(`✅ Đã đăng nhập: ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {

  // ── /xidach ──────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'xidach') {
    // Remove any leftover game for this user
    games.delete(interaction.user.id);

    await interaction.reply({
      embeds:     [lobbyEmbed(interaction.user)],
      components: [lobbyRow()],
    });
    return;
  }

  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  // ── Owner check (for all buttons) ────────────────────────────────────────
  const ownerId = getMessageOwner(interaction);
  if (ownerId && ownerId !== userId) {
    return interaction.reply({
      content:   '❌ Đây không phải game của bạn!',
      ephemeral: true,
    });
  }

  // ── Bắt đầu ──────────────────────────────────────────────────────────────
  if (interaction.customId === 'bj_start') {
    await interaction.update({
      embeds:     [betEmbed(interaction.user)],
      components: betRow(userId),
    });
    return;
  }

  // ── Huỷ ──────────────────────────────────────────────────────────────────
  if (interaction.customId === 'bj_cancel') {
    games.delete(userId);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('🃏 Xì Dách')
          .setDescription('Đã huỷ phòng.')
          .setColor(0x808080),
      ],
      components: [],
    });
    return;
  }

  // ── Đặt cược ─────────────────────────────────────────────────────────────
  if (interaction.customId.startsWith('bj_bet_')) {
    const bet = parseInt(interaction.customId.replace('bj_bet_', ''), 10);
    const bal = getBalance(userId);

    if (bal < bet) {
      return interaction.reply({ content: '❌ Số dư không đủ!', ephemeral: true });
    }

    const deck        = createDeck();
    const playerCards = [deck.pop(), deck.pop()];
    const botCards    = [deck.pop(), deck.pop()];

    const game = { phase: 'playing', ownerId: userId, bet, deck, playerCards, botCards };
    games.set(userId, game);

    // Natural blackjack check
    if (isBlackjack(playerCards)) {
      if (isBlackjack(botCards)) {
        // Both blackjack → tie, return bet
        games.delete(userId);
        return interaction.update({ embeds: [resultEmbed(game, 'tie', 0)], components: [] });
      }
      // Player blackjack → 1.5× payout
      const payout = Math.floor(bet * 1.5);
      addBalance(userId, payout);
      games.delete(userId);
      return interaction.update({ embeds: [resultEmbed(game, 'blackjack', payout)], components: [] });
    }

    await interaction.update({
      embeds:     [gameEmbed(game)],
      components: [gameRow()],
    });
    return;
  }

  // ── Game actions — require active game ───────────────────────────────────
  const game = games.get(userId);
  if (!game || game.phase !== 'playing') {
    return interaction.reply({ content: '❌ Bạn chưa có game! Dùng `/xidach`', ephemeral: true });
  }

  // ── Xem bài (ephemeral) ──────────────────────────────────────────────────
  if (interaction.customId === 'bj_view') {
    const pVal  = handValue(game.playerCards);
    const pHand = game.playerCards.map(cardStr).join(' ');
    const bFirst = cardStr(game.botCards[0]);

    return interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle('👁️ Bài của bạn')
          .setColor(0x5865F2)
          .addFields(
            { name: '🃏 Lá bài', value: pHand, inline: true },
            { name: '📊 Tổng điểm', value: `**${pVal}**`, inline: true },
          )
          .addFields(
            { name: '🤖 Lá lộ của Bot', value: bFirst, inline: false },
          )
          .setFooter({ text: 'Chỉ mình bạn thấy tin nhắn này.' }),
      ],
    });
  }

  // ── Rút thêm ─────────────────────────────────────────────────────────────
  if (interaction.customId === 'bj_hit') {
    game.playerCards.push(game.deck.pop());
    const pVal = handValue(game.playerCards);

    // Bust
    if (pVal > 21) {
      addBalance(userId, -game.bet);
      games.delete(userId);
      return interaction.update({ embeds: [resultEmbed(game, 'bust', 0)], components: [] });
    }

    // Auto-stand at 21
    if (pVal === 21) {
      return resolveStand(interaction, game, userId);
    }

    return interaction.update({ embeds: [gameEmbed(game)], components: [gameRow()] });
  }

  // ── Dừng ─────────────────────────────────────────────────────────────────
  if (interaction.customId === 'bj_stand') {
    return resolveStand(interaction, game, userId);
  }
});

// ─── Resolve stand/auto-stand ──────────────────────────────────────────────
async function resolveStand(interaction, game, userId) {
  const pVal = handValue(game.playerCards);

  // Bot draws until ≥ 17
  while (handValue(game.botCards) < 17) {
    game.botCards.push(game.deck.pop());
  }
  const bVal = handValue(game.botCards);

  let result, payout = 0;
  if (bVal > 21) {
    result = 'botbust';
    payout = game.bet;
    addBalance(userId, payout);
  } else if (pVal > bVal) {
    result = 'win';
    payout = game.bet;
    addBalance(userId, payout);
  } else if (pVal < bVal) {
    result = 'lose';
    addBalance(userId, -game.bet);
  } else {
    result = 'tie';
    // no change
  }

  games.delete(userId);
  return interaction.update({ embeds: [resultEmbed(game, result, payout)], components: [] });
}

// ─── Login ─────────────────────────────────────────────────────────────────
const token = process.env.DISCORD_TOKEN;
if (!token || token === 'YOUR_BOT_TOKEN') {
  console.error('❌ Thiếu DISCORD_TOKEN. Đặt biến môi trường DISCORD_TOKEN trước khi chạy.');
  process.exit(1);
}
client.login(token);
