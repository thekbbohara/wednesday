// The long-run eval script: hundreds of owner turns with facts planted early,
// some changed later, buried in noise, then probed long after. Deterministic
// for a given seed, so runs are comparable.

/** Every listed group must match; a group matches when any of its words is in the answer. */
export type Expect = string[][]

export interface Plant {
  id: string
  /** What the owner says. */
  say: string
  direct: string
  /** Same question with no content word shared with `say`. */
  paraphrase: string
  expect: Expect
  /** A later change: the probe must then give the new value. */
  update?: { say: string; expect: Expect; old: string[] }
}

export const ALL_PLANTS: Plant[] = [
  {
    id: 'scraper-lib',
    say: 'Decision for the price scraper: we use Playwright, not Selenium, because Selenium kept getting blocked by Cloudflare.',
    direct: 'Which library does the price scraper use, and why?',
    paraphrase: 'For the thing that pulls prices off websites, what tooling did we settle on and what was the reasoning?',
    expect: [['playwright'], ['cloudflare', 'blocked']],
  },
  {
    id: 'stockmate-host',
    say: 'StockMate will be hosted on a Hetzner VPS with Docker Compose. Not Vercel: we want Postgres on the same box.',
    direct: 'Where is StockMate hosted?',
    paraphrase: 'Which provider runs the inventory app for the shop customer?',
    expect: [['hetzner']],
    update: {
      say: 'Change of plan for StockMate hosting: we are moving it from Hetzner to DigitalOcean, because the client already pays for a DigitalOcean account.',
      expect: [['digitalocean', 'digital ocean']],
      old: ['hetzner'],
    },
  },
  {
    id: 'accountant',
    say: 'My accountant is Bikash Thapa. He files the VAT return by the 25th of every month.',
    direct: 'Who is my accountant and when does he file VAT?',
    paraphrase: 'Who handles my taxes, and what is the monthly deadline?',
    expect: [['bikash'], ['25']],
  },
  {
    id: 'rate',
    say: 'My freelance rate for new clients is 2,500 NPR per hour.',
    direct: 'What is my hourly rate for new clients?',
    paraphrase: 'How much do I charge someone fresh for sixty minutes of my time?',
    expect: [['2,500', '2500']],
    update: {
      say: 'From now on my hourly rate for new clients is 3,200 NPR. Raise it everywhere.',
      expect: [['3,200', '3200']],
      old: ['2,500', '2500'],
    },
  },
  {
    id: 'designer',
    say: 'Sita Gurung is the designer on StockMate. Reach her on WhatsApp, never email; she does not check email.',
    direct: 'How should I contact Sita?',
    paraphrase: 'What channel works for reaching the person who draws the screens for the inventory product?',
    expect: [['whatsapp']],
  },
  {
    id: 'db-choice',
    say: 'For portfolio-nepal we chose SQLite over Postgres, because it runs on a single small VM and backups are just a file copy.',
    direct: 'Why did portfolio-nepal choose SQLite?',
    paraphrase: 'For the share tracking product, what storage engine did we pick and what made it attractive?',
    expect: [['sqlite'], ['single', 'small', 'backup', 'file copy', 'vm']],
  },
  {
    id: 'standup',
    say: 'Standup with the StockMate client is every Tuesday at 10:30.',
    direct: 'When is the StockMate standup?',
    paraphrase: 'On which weekday and hour do I sync with the shop customer?',
    expect: [['tuesday'], ['10:30']],
    update: {
      say: 'The StockMate standup moved to Thursday at 11:00, starting this week.',
      expect: [['thursday'], ['11']],
      old: ['tuesday'],
    },
  },
  {
    id: 'brand-color',
    say: 'Blacknote brand color is #e8793a, the orange. Use it as the only accent.',
    direct: 'What is the Blacknote brand color?',
    paraphrase: 'Which hex code highlights the voice-note clips label?',
    expect: [['e8793a']],
  },
  {
    id: 'domain',
    say: 'We bought sunchadi.com for the gold price tracker. Registrar is Namecheap.',
    direct: 'What domain did we buy for the gold tracker, and where?',
    paraphrase: 'For the precious metal rates site, which web address do we own and through which company?',
    expect: [['sunchadi.com'], ['namecheap']],
  },
  {
    id: 'gpu',
    say: 'My workstation GPU is a GTX 1060, so any PyTorch work must pin the cu126 wheels.',
    direct: 'What GPU do I have and what does it mean for PyTorch?',
    paraphrase: 'What graphics card is in my machine, and which build of the deep learning library works on it?',
    expect: [['1060'], ['cu126', '12.6']],
  },
  {
    id: 'ticket-branch',
    say: 'Rule for Jira work: the git branch name is exactly the ticket key, like PN-13, no prefix.',
    direct: 'How do we name git branches for Jira tickets?',
    paraphrase: 'If I pick up issue number 40 in our tracker, what will its line of development be called?',
    expect: [['key', 'pn-']],
  },
  {
    id: 'client-budget',
    say: 'The StockMate client approved a budget of 180,000 NPR for phase two.',
    direct: 'What budget did the StockMate client approve for phase two?',
    paraphrase: 'How much money did the shop customer sign off for the second stage?',
    expect: [['180,000', '180000', '1.8 lakh', '180k']],
  },
  {
    id: 'posting',
    say: 'Social posting cadence: Instagram and Threads three times a week, reels only on Fridays.',
    direct: 'How often do we post on Instagram, and when do reels go out?',
    paraphrase: 'What is the weekly rhythm for our photo and short video channels?',
    expect: [['three', '3'], ['friday']],
  },
  {
    id: 'backup',
    say: 'Backups for all servers go to Backblaze B2, nightly at 2am, kept for 30 days.',
    direct: 'Where do server backups go and how long are they kept?',
    paraphrase: 'Where do copies of our machines end up each night, and for how long do we hold them?',
    expect: [['backblaze', 'b2'], ['30']],
  },
  {
    id: 'video-tool',
    say: 'All videos are built with HyperFrames, not Remotion. Remotion licensing was the deciding factor.',
    direct: 'Which tool do we use for videos, and why not Remotion?',
    paraphrase: 'What do we make our motion pieces with, and what ruled out the React alternative?',
    expect: [['hyperframes'], ['licens']],
  },
  {
    id: 'invoice-day',
    say: 'Invoices to all retainer clients go out on the 1st of each month, in NPR, from NIC Asia.',
    direct: 'When do retainer invoices go out and from which bank?',
    paraphrase: 'On what date do I bill ongoing customers, and which account receives it?',
    expect: [['1st', 'first'], ['nic asia', 'nic']],
  },
  {
    id: 'mentor',
    say: 'My mentor is Ramesh Adhikari. We meet the first Sunday of each month at Himalayan Java in Thamel.',
    direct: 'Who is my mentor and where do we meet?',
    paraphrase: 'Which advisor do I see monthly, and at what cafe?',
    expect: [['ramesh'], ['himalayan java', 'thamel']],
  },
  {
    id: 'no-friday-deploys',
    say: 'Rule: no production deploys on Fridays. Too many weekend fires last year.',
    direct: 'Is there a rule about deploying on Fridays?',
    paraphrase: 'Can I ship to live servers at the end of the work week?',
    expect: [['friday'], ['no', 'not', "don't", 'avoid']],
  },
  {
    id: 'phone-os',
    say: 'Test devices: Anil tests our apps on a Samsung A54 running Android 14.',
    direct: 'Which device does Anil test on?',
    paraphrase: 'What handset does my friend use to try our mobile builds?',
    expect: [['a54', 'samsung'], ['14', 'android']],
  },
  {
    id: 'llm-for-workers',
    say: 'Decision: unattended file-writing jobs go to pi with DeepSeek, not kimi, because kimi -p was blocked by the auto-mode classifier.',
    direct: 'Which agent do we use for unattended file-writing jobs, and why not kimi?',
    paraphrase: 'For background coding chores nobody watches, which assistant runs them and what stopped the other one?',
    expect: [['pi', 'deepseek'], ['classifier', 'blocked', 'auto']],
  },
]

/** Things the owner never says; the captain must not invent them. */
export const ALL_NEVER_SAID: string[] = [
  "What did I tell you my sister's name is?",
  'Which car did I say I drive?',
  'What is the name of my dog, as I told you?',
  'Which gym did I say I go to?',
  'What did I say my blood type is?',
  'Which university did I tell you I graduated from?',
  "What did I say my landlord's phone number is?",
  'What did we decide about the Android widget for StockMate?',
]

const NOISE: string[] = [
  'Thanks!',
  'ok',
  'Good morning.',
  'What is {a} times {b}?',
  'Give me a one-line motivational quote.',
  'Suggest a name for a {thing}.',
  'Rewrite this more politely: "send me the file now"',
  'What day of the week is it today?',
  'Translate "{word}" into Nepali.',
  'Is it better to write tests first or after? One sentence.',
  'Tell me a short joke about {thing}s.',
  'How many minutes are in {a} hours?',
  'Summarise in one line why backups matter.',
  'What is a good lunch idea in Kathmandu?',
  'Remind me to drink water. Just say ok.',
  'Draft a tweet about {thing}s, under 20 words.',
  'What does HTTP 418 mean?',
  'Spell "{word}" backwards.',
  'Pick a random number between 1 and {a}.',
  'Give me three synonyms for "{word}".',
  'Explain {thing} in one sentence.',
  'Nice, thanks.',
  'brb',
  'What is the capital of {country}?',
  'Convert {a} kilometers to miles.',
]
const FILL = {
  thing: ['cat', 'bakery', 'podcast', 'bicycle', 'teapot', 'robot', 'garden', 'kite', 'notebook', 'drum'],
  word: ['river', 'lantern', 'patience', 'window', 'harvest', 'thunder', 'quiet', 'mirror'],
  country: ['Peru', 'Kenya', 'Norway', 'Vietnam', 'Chile', 'Ghana', 'Iceland', 'Bhutan'],
}

export type TurnKind = 'plant' | 'update' | 'noise' | 'probe'
/** recall: the planted value; updated: the value after a change; never-said: must not be invented. */
export type ProbeKind = 'recall' | 'updated' | 'never-said'
export type Phrasing = 'direct' | 'paraphrase'

export interface Turn {
  index: number
  kind: TurnKind
  text: string
  plant?: string
  probe?: { kind: ProbeKind; phrasing: Phrasing; expect: Expect; old?: string[] }
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ScenarioOptions {
  turns: number
  seed?: number
  /** Use only the first N plants (and a matching share of never-said probes), for short smoke runs. */
  plants?: number
}

/**
 * Lays out the run: plants in the first fifth, updates in the middle, probes
 * in the last third (each long after what it asks about), noise everywhere
 * else. Every plant gets a direct and a paraphrased probe; updated plants are
 * probed for their new value.
 */
export function buildScenario({ turns, seed = 7, plants }: ScenarioOptions): Turn[] {
  const rand = rng(seed)
  const PLANTS = plants ? ALL_PLANTS.slice(0, plants) : ALL_PLANTS
  const NEVER_SAID = plants ? ALL_NEVER_SAID.slice(0, Math.max(1, Math.round((plants * ALL_NEVER_SAID.length) / ALL_PLANTS.length))) : ALL_NEVER_SAID
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
  const probes = PLANTS.length * 2 + NEVER_SAID.length
  const fixed = PLANTS.length + PLANTS.filter((p) => p.update).length + probes
  if (turns < fixed + 20) throw new Error(`need at least ${fixed + 20} turns for this scenario`)

  const slots: (Omit<Turn, 'index'> | null)[] = Array(turns).fill(null)
  const place = (from: number, to: number, t: Omit<Turn, 'index'>) => {
    for (let tries = 0; tries < 10_000; tries++) {
      const i = from + Math.floor(rand() * (to - from))
      if (!slots[i]) {
        slots[i] = t
        return
      }
    }
    throw new Error('scenario too dense')
  }

  const plantEnd = Math.floor(turns * 0.2)
  const updFrom = Math.floor(turns * 0.35)
  const updEnd = Math.floor(turns * 0.55)
  const probeFrom = Math.floor(turns * 0.65)
  for (const p of PLANTS) place(0, plantEnd, { kind: 'plant', text: p.say, plant: p.id })
  for (const p of PLANTS.filter((x) => x.update)) place(updFrom, updEnd, { kind: 'update', text: p.update!.say, plant: p.id })
  for (const p of PLANTS) {
    const want = p.update ? { kind: 'updated' as const, expect: p.update.expect, old: p.update.old } : { kind: 'recall' as const, expect: p.expect }
    place(probeFrom, turns, { kind: 'probe', text: p.direct, plant: p.id, probe: { ...want, phrasing: 'direct' } })
    place(probeFrom, turns, { kind: 'probe', text: p.paraphrase, plant: p.id, probe: { ...want, phrasing: 'paraphrase' } })
  }
  for (const q of NEVER_SAID) place(probeFrom, turns, { kind: 'probe', text: q, probe: { kind: 'never-said', phrasing: 'direct', expect: [] } })

  return slots.map((s, index) => {
    if (s) return { index, ...s }
    const text = pick(NOISE)
      .replace('{a}', String(2 + Math.floor(rand() * 40)))
      .replace('{b}', String(2 + Math.floor(rand() * 40)))
      .replace('{thing}', pick(FILL.thing))
      .replace('{word}', pick(FILL.word))
      .replace('{country}', pick(FILL.country))
    return { index, kind: 'noise' as const, text }
  })
}

export { ALL_PLANTS as PLANTS, ALL_NEVER_SAID as NEVER_SAID }
