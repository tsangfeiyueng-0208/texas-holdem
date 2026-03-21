import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

type Suit = 's' | 'h' | 'd' | 'c'
type Rank = number // 2..14 (A=14)

type Card = { suit: Suit; rank: Rank }

type GameStage =
  | 'ready'
  | 'preflop_decision'
  | 'dealing_flop'
  | 'dealing_turn'
  | 'dealing_river'
  | 'showdown'
  | 'hand_end'

type HandEval = {
  // Higher is better. Compare by lexicographic array.
  value: number[]
}

const SB = 5
const BB = 10
const CALL = BB - SB // heads-up, user is SB

const SUIT_SYMBOL: Record<Suit, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
}

const RANK_SYMBOL: Record<Rank, string> = {
  14: 'A',
  13: 'K',
  12: 'Q',
  11: 'J',
  10: 'T',
  9: '9',
  8: '8',
  7: '7',
  6: '6',
  5: '5',
  4: '4',
  3: '3',
  2: '2',
}

function newDeck(): Card[] {
  const suits: Suit[] = ['s', 'h', 'd', 'c']
  const deck: Card[] = []
  for (const suit of suits) {
    for (let r = 2; r <= 14; r++) deck.push({ suit, rank: r })
  }
  return deck
}

function shuffle<T>(arr: T[]) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function compareEval(a: HandEval, b: HandEval) {
  const av = a.value
  const bv = b.value
  const n = Math.min(av.length, bv.length)
  for (let i = 0; i < n; i++) {
    if (av[i] !== bv[i]) return av[i] - bv[i]
  }
  return av.length - bv.length
}

function eval5(cards: Card[]): HandEval {
  // Category: 8..0 (higher better)
  // 8 straight flush
  // 7 four of a kind
  // 6 full house
  // 5 flush
  // 4 straight
  // 3 three of a kind
  // 2 two pairs
  // 1 one pair
  // 0 high card
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a)
  const suits = cards.map((c) => c.suit)

  const rankCounts = new Map<Rank, number>()
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1)
  }

  const counts = [...rankCounts.entries()] // [rank, count]
  counts.sort((a, b) => {
    // count desc, then rank desc
    if (b[1] !== a[1]) return b[1] - a[1]
    return b[0] - a[0]
  })

  const isFlush = new Set(suits).size === 1

  // Straight detection (handle wheel A-2-3-4-5)
  const uniqueRanksAsc = [...new Set(cards.map((c) => c.rank))].sort((a, b) => a - b)
  let isStraight = false
  let straightHigh = 0
  if (uniqueRanksAsc.length === 5) {
    const min = uniqueRanksAsc[0]
    const max = uniqueRanksAsc[4]
    if (max - min === 4) {
      isStraight = true
      straightHigh = max
    } else {
      // Wheel: 2,3,4,5,A => ranks [2,3,4,5,14]
      if (
        uniqueRanksAsc[0] === 2 &&
        uniqueRanksAsc[1] === 3 &&
        uniqueRanksAsc[2] === 4 &&
        uniqueRanksAsc[3] === 5 &&
        uniqueRanksAsc[4] === 14
      ) {
        isStraight = true
        straightHigh = 5
      }
    }
  }

  if (isStraight && isFlush) return { value: [8, straightHigh] }

  if (counts[0]?.[1] === 4) {
    const quadRank = counts[0][0]
    const kicker = counts[1][0]
    return { value: [7, quadRank, kicker] }
  }

  if (counts[0]?.[1] === 3 && counts[1]?.[1] === 2) {
    const tripsRank = counts[0][0]
    const pairRank = counts[1][0]
    return { value: [6, tripsRank, pairRank] }
  }

  if (isFlush) return { value: [5, ...ranks] }

  if (isStraight) return { value: [4, straightHigh] }

  if (counts[0]?.[1] === 3) {
    const tripsRank = counts[0][0]
    const kickers = counts
      .slice(1)
      .map((x) => x[0])
      .sort((a, b) => b - a)
    return { value: [3, tripsRank, ...kickers] }
  }

  if (counts[0]?.[1] === 2 && counts[1]?.[1] === 2) {
    const pair1 = counts[0][0]
    const pair2 = counts[1][0]
    const highPair = Math.max(pair1, pair2)
    const lowPair = Math.min(pair1, pair2)
    const kicker = counts[2][0]
    return { value: [2, highPair, lowPair, kicker] }
  }

  if (counts[0]?.[1] === 2) {
    const pairRank = counts[0][0]
    const kickers = counts
      .slice(1)
      .map((x) => x[0])
      .sort((a, b) => b - a)
    return { value: [1, pairRank, ...kickers] }
  }

  return { value: [0, ...ranks] }
}

function eval7(cards: Card[]): HandEval {
  // 7 cards -> best 5-card hand among 21 combos.
  let best: HandEval | null = null
  const idx = [0, 1, 2, 3, 4, 5, 6]
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      for (let c = b + 1; c < 7; c++) {
        for (let d = c + 1; d < 7; d++) {
          for (let e = d + 1; e < 7; e++) {
            const five = [idx[a], idx[b], idx[c], idx[d], idx[e]].map((i) => cards[i])
            const ev = eval5(five)
            if (!best || compareEval(ev, best) > 0) best = ev
          }
        }
      }
    }
  }
  return best!
}

function formatCard(c: Card) {
  return `${RANK_SYMBOL[c.rank]}${SUIT_SYMBOL[c.suit]}`
}

function cardColor(suit: Suit) {
  return suit === 'h' || suit === 'd' ? '#dc2626' : '#111827'
}

function CardView({ card, faceDown }: { card?: Card | null; faceDown?: boolean }) {
  const style: CSSProperties = {
    width: 56,
    height: 78,
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.15)',
    background: faceDown ? 'linear-gradient(135deg,#111827,#374151)' : '#ffffff',
    boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    fontWeight: 700,
    color: faceDown ? '#f9fafb' : card ? cardColor(card.suit) : '#111827',
    userSelect: 'none',
  }
  return <div style={style}>{faceDown ? '★' : card ? formatCard(card) : ''}</div>
}

function categoryLabel(category: number) {
  switch (category) {
    case 8:
      return '同花顺'
    case 7:
      return '四条'
    case 6:
      return '葫芦'
    case 5:
      return '同花'
    case 4:
      return '顺子'
    case 3:
      return '三条'
    case 2:
      return '两对'
    case 1:
      return '一对'
    default:
      return '高牌'
  }
}

function GamePage({
  onBack,
  onReset,
}: {
  onBack: () => void
  onReset: () => void
}) {
  const [stage, setStage] = useState<GameStage>('ready')
  const [handNo, setHandNo] = useState(0)

  const [userChips, setUserChips] = useState(1000)
  const [botChips, setBotChips] = useState(1000)
  const [pot, setPot] = useState(0)

  const [userHole, setUserHole] = useState<Card[]>([])
  const [botHole, setBotHole] = useState<Card[]>([])
  const [community, setCommunity] = useState<Card[]>([])

  const [message, setMessage] = useState('')

  const canStart = userChips >= SB && botChips >= BB && stage === 'ready'
  const canCall = userChips >= CALL && stage === 'preflop_decision'

  const potRef = useRef(pot)
  useEffect(() => {
    potRef.current = pot
  }, [pot])

  const showdown = () => {
    setStage('showdown')
    const user7 = [...userHole, ...community]
    const bot7 = [...botHole, ...community]
    const uEval = eval7(user7)
    const bEval = eval7(bot7)

    const cmp = compareEval(uEval, bEval)
    let w: 'user' | 'bot' | 'tie' = 'tie'
    if (cmp > 0) w = 'user'
    if (cmp < 0) w = 'bot'

    if (w === 'tie') {
      const p = potRef.current
      const half = Math.floor(p / 2)
      const rem = p - half * 2
      // Give odd chip to user for determinism.
      setUserChips((c) => c + half + rem)
      setBotChips((c) => c + half)
      setMessage('平分底池！')
    } else if (w === 'user') {
      setUserChips((c) => c + potRef.current)
      setMessage(
        `你赢了！（${categoryLabel(uEval.value[0])} vs ${categoryLabel(bEval.value[0])}）`,
      )
    } else {
      setBotChips((c) => c + potRef.current)
      setMessage(
        `电脑赢了！（${categoryLabel(bEval.value[0])} vs ${categoryLabel(uEval.value[0])}）`,
      )
    }

    setStage('hand_end')
  }

  const startHand = () => {
    if (userChips < SB || botChips < BB) return
    setHandNo((n) => n + 1)
    setMessage('')

    setUserHole([])
    setBotHole([])
    setCommunity([])
    setPot(SB + BB)
    setStage('preflop_decision')

    // Post blinds
    setUserChips((c) => c - SB)
    setBotChips((c) => c - BB)

    const deck = shuffle(newDeck())
    setUserHole([deck[0], deck[1]])
    setBotHole([deck[2], deck[3]])
  }

  const fold = () => {
    if (stage !== 'preflop_decision') return
    setBotChips((c) => c + potRef.current)
    setMessage('你弃牌了。电脑赢得底池。')
    setStage('hand_end')
  }

  const call = () => {
    if (stage !== 'preflop_decision' || userChips < CALL) return

    setMessage('')
    setUserChips((c) => c - CALL)
    setPot((p) => p + CALL)

    // Deal community by constructing a remaining deck excluding known hole cards.
    const deck = shuffle(newDeck())
    const used = new Set([...userHole, ...botHole].map((c) => `${c.rank}${c.suit}`))
    const remaining: Card[] = []
    for (const c of deck) {
      const key = `${c.rank}${c.suit}`
      if (!used.has(key)) remaining.push(c)
    }
    const nextCommunity = remaining.slice(0, 5)

    setStage('dealing_flop')
    setCommunity(nextCommunity.slice(0, 3))

    window.setTimeout(() => {
      setStage('dealing_turn')
      setCommunity(nextCommunity.slice(0, 4))
    }, 600)

    window.setTimeout(() => {
      setStage('dealing_river')
      setCommunity(nextCommunity.slice(0, 5))
    }, 1200)

    window.setTimeout(() => showdown(), 1800)
  }

  const progressLabel = useMemo(() => {
    if (stage === 'preflop_decision') return '翻牌前：弃牌/跟注后进入摊牌'
    if (stage === 'dealing_flop') return '翻牌发出中...'
    if (stage === 'dealing_turn') return '转牌发出中...'
    if (stage === 'dealing_river') return '河牌发出中...'
    if (stage === 'showdown') return '摊牌计算中...'
    if (stage === 'hand_end') return '本局结束'
    return '准备开始'
  }, [stage])

  useEffect(() => {
    if (userChips <= 0 || botChips <= 0) {
      setStage('hand_end')
      if (userChips <= 0 && botChips > 0) setMessage('你破产了。')
      else if (botChips <= 0 && userChips > 0) setMessage('电脑破产了。')
      else if (userChips <= 0 && botChips <= 0) setMessage('你们同时破产了。')
    }
  }, [userChips, botChips])

  return (
    <div
      style={{
        minHeight: '100svh',
        background: 'linear-gradient(180deg,#052e2b,#062c3c)',
        color: 'white',
        padding: 18,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          paddingBottom: 12,
        }}
      >
        <div style={{ fontWeight: 900, opacity: 0.9 }}>正式娱乐环节</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={onBack}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(148,163,184,0.9)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            返回
          </button>
          <button
            onClick={onReset}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(245,158,11,0.95)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            重置
          </button>
        </div>
      </div>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 30, letterSpacing: -0.5 }}>
              德州扑克学习与试玩
            </h1>
            <div style={{ opacity: 0.9, marginTop: 6 }}>{progressLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div
              style={{
                padding: '8px 12px',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.85 }}>底池</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{pot}</div>
            </div>
            <div
              style={{
                padding: '8px 12px',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.85 }}>局数</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{handNo}</div>
            </div>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 18, marginTop: 18 }}>
          <section style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ opacity: 0.9, fontSize: 14 }}>你的筹码（SB）</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{userChips}</div>
                <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>
                  盲注：SB={SB} / BB={BB}，跟注需要 {CALL}
                </div>
              </div>
              <div>
                <div style={{ opacity: 0.9, fontSize: 14 }}>电脑筹码（BB）</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>{botChips}</div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ opacity: 0.9, marginBottom: 10, fontSize: 14 }}>底牌（你的手牌）</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <CardView card={userHole[0]} faceDown={false} />
                <CardView card={userHole[1]} faceDown={false} />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ opacity: 0.9, marginBottom: 10, fontSize: 14 }}>电脑手牌</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <CardView card={botHole[0]} faceDown={stage !== 'showdown' && stage !== 'hand_end'} />
                <CardView card={botHole[1]} faceDown={stage !== 'showdown' && stage !== 'hand_end'} />
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ opacity: 0.9, marginBottom: 10, fontSize: 14 }}>公共牌</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <CardView key={i} card={community[i]} faceDown={false} />
                ))}
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              {stage === 'ready' && (
                <button
                  onClick={startHand}
                  disabled={!canStart}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: canStart ? 'rgba(59,130,246,0.95)' : 'rgba(100,116,139,0.7)',
                    color: 'white',
                    cursor: canStart ? 'pointer' : 'not-allowed',
                    fontWeight: 800,
                  }}
                >
                  开始一局（发牌）
                </button>
              )}

              {stage === 'preflop_decision' && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={fold}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(239,68,68,0.95)',
                      color: 'white',
                      cursor: 'pointer',
                      fontWeight: 800,
                    }}
                  >
                    弃牌
                  </button>
                  <button
                    onClick={call}
                    disabled={!canCall}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: canCall ? 'rgba(34,197,94,0.95)' : 'rgba(100,116,139,0.7)',
                      color: 'white',
                      cursor: canCall ? 'pointer' : 'not-allowed',
                      fontWeight: 800,
                    }}
                  >
                    跟注 {CALL}
                  </button>
                </div>
              )}

              {stage === 'hand_end' && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setStage('ready')}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(59,130,246,0.95)',
                      color: 'white',
                      cursor: 'pointer',
                      fontWeight: 800,
                    }}
                  >
                    下一局
                  </button>
                  {message && <div style={{ opacity: 0.95, fontWeight: 700 }}>{message}</div>}
                </div>
              )}

              {stage !== 'ready' && stage !== 'hand_end' && message && (
                <div style={{ marginTop: 14, opacity: 0.95, fontWeight: 700 }}>{message}</div>
              )}
            </div>
          </section>

          <aside style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>规则速学</h2>
            <p style={{ marginTop: 10, opacity: 0.9, fontSize: 14 }}>
              德州是“从 7 张里取最强 5 张”。从大到小：
            </p>
            <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.8 }}>
              <div>1. 同花顺</div>
              <div>2. 四条</div>
              <div>3. 葫芦</div>
              <div>4. 同花</div>
              <div>5. 顺子</div>
              <div>6. 三条</div>
              <div>7. 两对</div>
              <div>8. 一对</div>
              <div>9. 高牌</div>
            </div>

            <div style={{ marginTop: 16, opacity: 0.95, fontSize: 14, lineHeight: 1.7 }}>
              <div>流程（简化版）：</div>
              <div>• 你是 SB= {SB}，电脑是 BB= {BB}</div>
              <div>• 只在翻牌前让你做决策：弃牌 / 跟注 {CALL}</div>
              <div>• 跟注后自动发翻牌、转牌、河牌并摊牌</div>
            </div>

            <div style={{ marginTop: 16, opacity: 0.85, fontSize: 12, lineHeight: 1.6 }}>
              提示：你不需要复杂下注也能学习牌型；重点观察公共牌能否组成顺子/同花，并记住“取最强 5 张”。
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

type View = 'village' | 'rules' | 'practice' | 'game'

const PRACTICE_DONE_KEY = 'texas_holdem_practice_done_v1'

function VillagePage({
  practiceDone,
  onEnterRules,
  onEnterPractice,
  onEnterGame,
  onResetAll,
}: {
  practiceDone: boolean
  onEnterRules: () => void
  onEnterPractice: () => void
  onEnterGame: () => void
  onResetAll: () => void
}) {
  return (
    <div
      style={{
        minHeight: '100svh',
        background: 'linear-gradient(180deg,#052e2b,#062c3c)',
        color: 'white',
        padding: 18,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 32, letterSpacing: -0.6 }}>新手村：德州规律入门</h1>
        <div style={{ marginTop: 10, opacity: 0.9, lineHeight: 1.7, fontSize: 14 }}>
          你将按顺序学习：<b>规则讲解</b> → <b>新手练习</b> → <b>正式娱乐环节</b>。
        </div>

        <div style={{ marginTop: 18, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 16 }}>
          <div style={{ opacity: 0.9, fontSize: 14, marginBottom: 10 }}>当前进度</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ padding: '10px 12px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12 }}>
              练习完成：<b>{practiceDone ? '是' : '否'}</b>
            </div>
            <div style={{ padding: '10px 12px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12 }}>
              快捷键：<b>Esc 返回</b>，<b>R 重置</b>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={onEnterRules}
            style={{
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(59,130,246,0.95)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 900,
            }}
          >
            学习规则讲解
          </button>
          <button
            onClick={onEnterPractice}
            style={{
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(34,197,94,0.95)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 900,
            }}
          >
            新手练习
          </button>
          <button
            onClick={onEnterGame}
            disabled={!practiceDone}
            style={{
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.2)',
              background: practiceDone ? 'rgba(245,158,11,0.95)' : 'rgba(100,116,139,0.7)',
              color: 'white',
              cursor: practiceDone ? 'pointer' : 'not-allowed',
              fontWeight: 900,
            }}
          >
            进入正式娱乐环节
          </button>
          <button
            onClick={onResetAll}
            style={{
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(239,68,68,0.95)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 900,
            }}
          >
            重置进度
          </button>
        </div>

        <div style={{ marginTop: 14, opacity: 0.85, fontSize: 12, lineHeight: 1.6 }}>
          说明：这是简化教学版。目的是让你看懂牌型与流程，能立刻开始玩。
        </div>
      </div>
    </div>
  )
}

function RulesPage({
  onBack,
  onResetAll,
  onStartPractice,
}: {
  onBack: () => void
  onResetAll: () => void
  onStartPractice: () => void
}) {
  return (
    <div
      style={{
        minHeight: '100svh',
        background: 'linear-gradient(180deg,#052e2b,#062c3c)',
        color: 'white',
        padding: 18,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, letterSpacing: -0.6 }}>规则讲解（新手）</h1>
            <div style={{ marginTop: 8, opacity: 0.9, fontSize: 12 }}>快捷键：Esc 返回，R 重置</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={onBack}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(148,163,184,0.9)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              返回
            </button>
            <button
              onClick={onResetAll}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(239,68,68,0.95)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              重置
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
          <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>你要记住的 4 件事</h2>
            <div style={{ marginTop: 10, opacity: 0.92, fontSize: 14, lineHeight: 1.8 }}>
              <div>1. <b>德州胜负看摊牌</b>：每人有 2 张手牌 + 5 张公共牌。</div>
              <div>2. <b>从 7 张里选最强 5 张</b>：摊牌时比较“最佳 5 张牌型”。</div>
              <div>3. <b>公共牌会分 3 次发出</b>：翻牌 3 张、转牌 1 张、河牌 1 张。</div>
              <div>4. <b>下注用折叠/跟注</b>：`Fold(弃牌)` 放弃本手牌；`Call(跟注)` 补到当前底池要求。</div>
            </div>

            <div style={{ marginTop: 14 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>牌型从大到小（速记）</h2>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.8 }}>
                <div>同花顺</div>
                <div>四条</div>
                <div>葫芦</div>
                <div>同花</div>
                <div>顺子</div>
                <div>三条</div>
                <div>两对</div>
                <div>一对</div>
                <div>高牌</div>
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>接下来</h2>
            <div style={{ marginTop: 10, opacity: 0.9, fontSize: 14, lineHeight: 1.7 }}>
              你会做一个小测验，帮助你把“牌型/流程/动作”记牢。通过后立刻进入娱乐环节。
            </div>
            <button
              onClick={onStartPractice}
              style={{
                marginTop: 14,
                width: '100%',
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(34,197,94,0.95)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 900,
              }}
            >
              去做新手练习
            </button>
            <div style={{ marginTop: 10, opacity: 0.85, fontSize: 12, lineHeight: 1.6 }}>
              提醒：练习题有解释，你做完能真正理解，而不是死记。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type PracticeQuestion = {
  prompt: string
  options: string[]
  correctIndex: number
  explanation: string
}

const PRACTICE_QUESTIONS: PracticeQuestion[] = [
  {
    prompt: '德州摊牌时：从几张牌里选最强 5 张？',
    options: ['5 张公共牌', '6 张（手牌+公共牌）', '7 张（手牌2 + 公共牌5）', '只看手牌'],
    correctIndex: 2,
    explanation: '德州（Texas Hold’em）摊牌比较的是“从 7 张牌里挑出最强的 5 张组合”。',
  },
  {
    prompt: '翻牌/转牌/河牌分别发几张公共牌？',
    options: ['3 / 1 / 1', '2 / 2 / 1', '1 / 1 / 3', '4 / 1 / 0'],
    correctIndex: 0,
    explanation: '流程固定：翻牌发 3 张公共牌，然后转牌 1 张，河牌 1 张。',
  },
  {
    prompt: 'A2345（同一花色也不一定）是否算顺子？',
    options: ['不算', '算，A 可以当作 1', '只能当高牌', '只在同花时才算'],
    correctIndex: 1,
    explanation: '顺子支持“轮子顺（wheel）”：A2345 也可以组成顺子（A 当作 1）。',
  },
  {
    prompt: '比较：四条 vs 同花，谁更大？',
    options: ['同花更大', '四条更大', '一样大', '看点数大小'],
    correctIndex: 1,
    explanation: '从大小排序看：四条（Four of a Kind）在同花（Flush）之上。',
  },
  {
    prompt: '在本网站的简化规则中：翻牌前你能做的主要动作是什么？',
    options: ['只允许加注', '可以弃牌或跟注', '只能跟注不能弃牌', '只能看牌不行动'],
    correctIndex: 1,
    explanation: '简化教学：你只需要理解 Fold（弃牌）和 Call（跟注），后续由系统自动发公共牌并摊牌。',
  },
  {
    prompt: 'Fold（弃牌）意味着什么？',
    options: ['你立刻赢得底池', '你放弃本手牌，不再参与该手的摊牌', '你把牌翻出来比较', '你把底池翻倍'],
    correctIndex: 1,
    explanation: '弃牌就是放弃这手牌：不会再参与后续摊牌。',
  },
]

function PracticePage({
  onBack,
  onReset,
  onComplete,
}: {
  onBack: () => void
  onReset: () => void
  onComplete: () => void
}) {
  const [order, setOrder] = useState<number[]>(() => shuffle(PRACTICE_QUESTIONS.map((_, i) => i)))
  const [pos, setPos] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [correct, setCorrect] = useState<boolean | null>(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)

  const q = PRACTICE_QUESTIONS[order[pos] ?? 0]

  const resetQuiz = () => {
    setOrder(shuffle(PRACTICE_QUESTIONS.map((_, i) => i)))
    setPos(0)
    setSelectedIndex(null)
    setCorrect(null)
    setScore(0)
    setDone(false)
    onReset()
  }

  const choose = (idx: number) => {
    if (done) return
    if (selectedIndex !== null) return
    setSelectedIndex(idx)
    const isRight = idx === q.correctIndex
    setCorrect(isRight)
    if (isRight) setScore((s) => s + 1)
  }

  const next = () => {
    if (selectedIndex === null || correct === null) return
    if (pos >= PRACTICE_QUESTIONS.length - 1) {
      setDone(true)
      return
    }
    setPos((p) => p + 1)
    setSelectedIndex(null)
    setCorrect(null)
  }

  return (
    <div
      style={{
        minHeight: '100svh',
        background: 'linear-gradient(180deg,#052e2b,#062c3c)',
        color: 'white',
        padding: 18,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, letterSpacing: -0.6 }}>新手练习</h1>
            <div style={{ marginTop: 8, opacity: 0.9, fontSize: 12 }}>快捷键：Esc 返回，R 重置</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={onBack}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(148,163,184,0.9)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              返回
            </button>
            <button
              onClick={resetQuiz}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(239,68,68,0.95)',
                color: 'white',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              重置
            </button>
          </div>
        </div>

        <div style={{ marginTop: 16, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 16 }}>
          {!done ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ opacity: 0.9, fontSize: 13 }}>
                  题目：<b>{pos + 1}</b> / {PRACTICE_QUESTIONS.length}
                </div>
                <div style={{ opacity: 0.9, fontSize: 13 }}>
                  当前得分：<b>{score}</b>
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 16, fontWeight: 900 }}>{q.prompt}</div>

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                {q.options.map((opt, i) => {
                  const isSelected = selectedIndex === i
                  const isCorrect = correct === true && isSelected
                  const isWrong = correct === false && isSelected
                  return (
                    <button
                      key={i}
                      onClick={() => choose(i)}
                      disabled={selectedIndex !== null}
                      style={{
                        textAlign: 'left',
                        padding: '12px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(255,255,255,0.2)',
                        background: isCorrect
                          ? 'rgba(34,197,94,0.95)'
                          : isWrong
                            ? 'rgba(239,68,68,0.95)'
                            : 'rgba(148,163,184,0.35)',
                        color: 'white',
                        cursor: selectedIndex !== null ? 'not-allowed' : 'pointer',
                        fontWeight: 800,
                      }}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>

              {selectedIndex !== null && correct !== null && (
                <div style={{ marginTop: 12, opacity: 0.95, lineHeight: 1.7, fontSize: 14 }}>
                  <div style={{ fontWeight: 900 }}>
                    {correct ? '回答正确！' : '回答不对。'}{' '}
                    <span style={{ opacity: 0.85 }}>（解释）</span>
                  </div>
                  <div style={{ marginTop: 6 }}>{q.explanation}</div>
                </div>
              )}

              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={next}
                  disabled={selectedIndex === null || correct === null}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background:
                      selectedIndex !== null && correct !== null ? 'rgba(59,130,246,0.95)' : 'rgba(100,116,139,0.7)',
                    color: 'white',
                    cursor: selectedIndex !== null && correct !== null ? 'pointer' : 'not-allowed',
                    fontWeight: 900,
                    width: 220,
                  }}
                >
                  {pos >= PRACTICE_QUESTIONS.length - 1 ? '完成练习' : '下一题'}
                </button>
              </div>
            </>
          ) : (
            <div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>练习完成！</div>
              <div style={{ marginTop: 10, opacity: 0.9, fontSize: 14, lineHeight: 1.7 }}>
                你的得分：<b>{score}</b> / {PRACTICE_QUESTIONS.length}。现在可以进入正式娱乐环节开始试玩。
              </div>
              <button
                onClick={onComplete}
                style={{
                  marginTop: 16,
                  width: '100%',
                  padding: '14px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(245,158,11,0.95)',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 900,
                }}
              >
                进入正式娱乐环节
              </button>
              <div style={{ marginTop: 10, opacity: 0.85, fontSize: 12, lineHeight: 1.6 }}>
                如果你想重新练习，按上方的“重置”即可。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('village')
  const [practiceDone, setPracticeDone] = useState(false)
  const [practiceKey, setPracticeKey] = useState(0)
  const [gameKey, setGameKey] = useState(0)

  useEffect(() => {
    const saved = localStorage.getItem(PRACTICE_DONE_KEY)
    setPracticeDone(saved === '1')
    // If already practiced, keep the user in village; they can enter game anytime.
  }, [])

  const resetAll = () => {
    localStorage.removeItem(PRACTICE_DONE_KEY)
    setPracticeDone(false)
    setView('village')
    setPracticeKey((k) => k + 1)
    setGameKey((k) => k + 1)
  }

  const resetPractice = () => {
    localStorage.removeItem(PRACTICE_DONE_KEY)
    setPracticeDone(false)
    setPracticeKey((k) => k + 1)
  }

  const goBack = () => {
    if (view === 'rules') setView('village')
    else if (view === 'practice') setView('rules')
    else if (view === 'game') setView('practice')
    else setView('village')
  }

  const goEnterGame = () => {
    if (!practiceDone) {
      setView('practice')
      return
    }
    setView('game')
  }

  useEffect(() => {
    if (view === 'game' && !practiceDone) setView('practice')
  }, [view, practiceDone])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = (t?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (t?.getAttribute('contenteditable') === 'true') return

      if (e.key === 'Escape') {
        e.preventDefault()
        goBack()
      }

      const k = e.key.toLowerCase()
      if (k === 'r') {
        e.preventDefault()
        if (view === 'village' || view === 'rules') resetAll()
        else if (view === 'practice') resetPractice()
        else if (view === 'game') setGameKey((x) => x + 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, practiceDone])

  return (
    <>
      {view === 'village' && (
        <VillagePage
          practiceDone={practiceDone}
          onEnterRules={() => setView('rules')}
          onEnterPractice={() => setView('practice')}
          onEnterGame={goEnterGame}
          onResetAll={resetAll}
        />
      )}
      {view === 'rules' && (
        <RulesPage
          onBack={() => setView('village')}
          onResetAll={resetAll}
          onStartPractice={() => setView('practice')}
        />
      )}
      {view === 'practice' && (
        <PracticePage
          key={practiceKey}
          onBack={() => setView('rules')}
          onReset={resetPractice}
          onComplete={() => {
            localStorage.setItem(PRACTICE_DONE_KEY, '1')
            setPracticeDone(true)
            setView('game')
            setGameKey((k) => k + 1)
          }}
        />
      )}
      {view === 'game' && (
        <GamePage
          key={gameKey}
          onBack={() => setView('practice')}
          onReset={() => setGameKey((k) => k + 1)}
        />
      )}
    </>
  )
}
