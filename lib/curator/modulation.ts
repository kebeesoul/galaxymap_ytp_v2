export const TOPIC_OPTIONS = {
  all: '전체',
  love: '사랑/연애/이별',
  selflove: '자기애/위로/성공/성취',
  nostalgia: '추억/그리움/우울/내면',
  dance: '댄스/파티/해방/자유',
} as const

export const ERA_OPTIONS = {
  all: '전체',
  '2020s': '2020년 이후',
  '2010s': '2010~2019',
  '2000s': '2000~2009',
  pre2000s: '2000년 이전',
} as const

export const GENRE_OPTIONS = {
  all: '전체',
  hiphopRnb: '힙합 / R&B / 소울',
  balladIndie: '발라드 / 인디 / 포크',
  kpop: 'K-pop / 댄스팝',
  rock: '록 / 밴드',
} as const

export type TopicKey = keyof typeof TOPIC_OPTIONS
export type EraKey = keyof typeof ERA_OPTIONS
export type GenreKey = keyof typeof GENRE_OPTIONS

export function isModulationValid(
  topic: TopicKey,
  era: EraKey,
  genre: GenreKey,
): boolean {
  return !(topic === 'all' && era === 'all' && genre === 'all')
}

export function buildModulationPromptLines(
  topic: TopicKey,
  era: EraKey,
  genre: GenreKey,
): string {
  const lines: string[] = []
  if (topic !== 'all') lines.push(`주제: ${TOPIC_OPTIONS[topic]}`)
  if (era !== 'all') lines.push(`시대: ${ERA_OPTIONS[era]}`)
  if (genre !== 'all') lines.push(`장르: ${GENRE_OPTIONS[genre]}`)
  return lines.join('\n')
}
