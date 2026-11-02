/**
 * Ready-made tropes: prewritten growth factors that need no model request.
 *
 * Pair tropes describe one directed line "subject → object" and may set a pace
 * per scale (slow caps a change, fast amplifies it — see pacedDelta). Triangle
 * tropes are written in roles — the center and the two sides — and expand to
 * the triangle's directed lines, with a suggested end point (goal).
 */
const PAIR_TROPES = [
  {
    id: 'slowburn', label: 'Слоуберн',
    description: 'Чувства копятся медленно, через мелочи и доверие; торопить их нельзя.',
    pace: { love: 'slow', attraction: 'slow', affection: 'slow' },
    factors: [
      ['affection', 'up', 'Долгие разговоры наедине, мелкая забота без повода'],
      ['trust', 'up', 'Держит обещания и хранит доверенные секреты'],
      ['attraction', 'up', 'Случайные прикосновения, задержавшийся взгляд'],
      ['love', 'up', 'Открывает уязвимость только ему'],
      ['love', 'down', 'Торопит события, давит на чувства'],
      ['trust', 'down', 'Нарушает личные границы'],
    ],
  },
  {
    id: 'enemies-to-lovers', label: 'От ненависти до любви',
    description: 'Вражда, которая через уважение и вынужденную близость перерастает в страсть и любовь.',
    factors: [
      ['respect', 'up', 'Показывает силу или мастерство в столкновении'],
      ['hostility', 'down', 'Прикрывает спину в настоящей опасности'],
      ['attraction', 'up', 'Стычка перерастает в напряжённую близость'],
      ['trust', 'up', 'Вынужденное сотрудничество, в котором не предал'],
      ['resentment', 'down', 'Признаёт свою неправоту'],
      ['hostility', 'up', 'Унижает при свидетелях'],
    ],
  },
  {
    id: 'lovers-to-enemies', label: 'От любви до ненависти',
    description: 'Любовь, которую разъедают предательство и ложь, пока не останется вражда.',
    factors: [
      ['resentment', 'up', 'Предаёт доверие или раскрывает тайну'],
      ['trust', 'down', 'Лжёт, действует из скрытых мотивов'],
      ['hostility', 'up', 'Встаёт на сторону врага или соперника'],
      ['love', 'down', 'Равнодушен к его боли'],
      ['affection', 'down', 'Пренебрегает им на людях'],
      ['jealousy', 'up', 'Сближается с соперником'],
    ],
  },
  {
    id: 'friends-to-lovers', label: 'Из друзей в возлюбленные',
    description: 'Давняя дружба постепенно открывает романтическую сторону.',
    factors: [
      ['friendship', 'up', 'Общие шутки, привычки и маленькие традиции'],
      ['attraction', 'up', 'Видит его в новом свете: смелость, внешность, заботу'],
      ['jealousy', 'up', 'Кто-то другой проявляет к нему интерес'],
      ['love', 'up', 'Выбирает его в трудную минуту, а не других'],
      ['friendship', 'down', 'Неловкость и избегание после намёка на чувства'],
    ],
  },
  {
    id: 'fast-passion', label: 'Страсть с разгона',
    description: 'Физическая близость вспыхивает сразу, и чувства догоняют её так же быстро.',
    pace: { attraction: 'fast', love: 'fast', affection: 'fast', dependency: 'fast' },
    factors: [
      ['attraction', 'up', 'Флирт, прикосновения, любая уединённая близость'],
      ['love', 'up', 'После близости остаётся рядом и нежен'],
      ['affection', 'up', 'Заботится наутро, не исчезает'],
      ['dependency', 'up', 'Ищет встречи снова и снова'],
      ['jealousy', 'up', 'Чужой интерес к нему'],
      ['love', 'down', 'Холодность и равнодушие после близости'],
    ],
  },
  {
    id: 'body-first', label: 'Сначала тело, потом сердце',
    description: 'Физически тянет сразу и сильно, а доверие и любовь растут медленно и трудно.',
    pace: { attraction: 'fast', love: 'slow', trust: 'slow', affection: 'slow' },
    factors: [
      ['attraction', 'up', 'Напряжение рядом, случайная или намеренная близость'],
      ['love', 'up', 'Редкие моменты открытости, не связанные с постелью'],
      ['trust', 'up', 'Остаётся, когда мог бы уйти'],
      ['trust', 'down', 'Использует близость как оружие или способ уйти от разговора'],
      ['love', 'down', 'Сводит всё только к телу'],
      ['resentment', 'up', 'Чувствует себя использованным'],
    ],
  },
  {
    id: 'forbidden', label: 'Запретная любовь',
    description: 'Чувства под запретом: тайна, риск и вина за обман близких.',
    factors: [
      ['love', 'up', 'Тайные встречи вопреки запрету'],
      ['fear', 'up', 'Риск разоблачения, близкая угроза'],
      ['dependency', 'up', 'Только с ним можно быть собой'],
      ['guilt', 'up', 'Обманывает близких ради встреч'],
      ['trust', 'down', 'Скрывает правду, которая касается их обоих'],
    ],
  },
  {
    id: 'rivals-to-allies', label: 'Соперники → союзники',
    description: 'Соперничество, которое через честную борьбу и общего врага становится союзом.',
    factors: [
      ['respect', 'up', 'Честная победа или достойное поражение'],
      ['hostility', 'down', 'Общая цель и общий враг'],
      ['trust', 'up', 'Прикрывает в бою или в споре'],
      ['approval', 'up', 'Разделяет его принципы'],
      ['respect', 'down', 'Жульничает или бьёт исподтишка'],
    ],
  },
  {
    id: 'protector', label: 'Защитник',
    description: 'Один оберегает другого; доверие и зависимость растут вместе с риском.',
    factors: [
      ['trust', 'up', 'Защищает без просьбы'],
      ['affection', 'up', 'Заботится о ранах и усталости'],
      ['dependency', 'up', 'Решает его проблемы за него'],
      ['approval', 'down', 'Безрассудно рискует собой'],
      ['guilt', 'up', 'Не уберёг от беды'],
    ],
  },
  {
    id: 'second-chance', label: 'Второй шанс',
    description: 'Бывшие, у которых есть шанс начать заново, если боль прошлого удастся загладить.',
    factors: [
      ['guilt', 'up', 'Вспоминает, как когда-то ранил'],
      ['love', 'up', 'Общие воспоминания о лучшем времени'],
      ['resentment', 'down', 'Искреннее извинение без оправданий'],
      ['trust', 'up', 'Последовательно доказывает, что изменился'],
      ['trust', 'down', 'Повторяет старую ошибку'],
      ['resentment', 'up', 'Напоминание о прошлой боли'],
    ],
  },
  {
    id: 'violence-victim', label: 'Насилие: тот, кто терпит',
    description: 'Линия того, кто терпит насилие: страх, ловушка зависимости, вспышки обиды и ложное облегчение после «извинений».',
    factors: [
      ['fear', 'up', 'Угрозы, удары, вспышки ярости'],
      ['trust', 'down', 'Насилие повторяется после обещаний, что больше не будет'],
      ['dependency', 'up', 'Изоляция от других: «кроме меня у тебя никого нет»'],
      ['affection', 'up', 'Редкая нежность после вспышки — ловушка привязанности'],
      ['resentment', 'up', 'Унижение и тотальный контроль'],
      ['hostility', 'up', 'Попытка дать отпор или уйти'],
    ],
  },
  {
    id: 'violence-aggressor', label: 'Насилие: тот, кто применяет',
    description: 'Линия того, кто контролирует и причиняет боль: собственничество, ярость и редкие уколы вины.',
    factors: [
      ['jealousy', 'up', 'Любая чужая близость к нему'],
      ['dependency', 'up', 'Страх потерять над ним контроль'],
      ['hostility', 'up', 'Неповиновение, попытка уйти'],
      ['guilt', 'up', 'Видит последствия своей вспышки'],
      ['approval', 'down', 'Проявление независимости'],
      ['respect', 'down', 'Его страх и покорность'],
    ],
  },
];

/** Roles: center, side (either of the two), rival (the other side). */
const TRIANGLE_TROPES = [
  {
    id: 'love-triangle', label: 'Любовный треугольник: выбор',
    description: 'Две стороны борются за чувства центра; центр постепенно делает выбор.',
    goal: 'Центр постепенно делает выбор между двумя; выбор созревает через события, а не объявляется. Сторона, которую не выбрали, получает свою развязку.',
    factors: [
      ['side', 'center', 'love', 'up', 'Центр выбирает его общество, а не соперника'],
      ['side', 'center', 'jealousy', 'up', 'Центр проводит время с соперником'],
      ['side', 'rival', 'jealousy', 'up', 'Соперник получает внимание центра'],
      ['side', 'rival', 'respect', 'up', 'Соперник поступает благородно по отношению к центру'],
      ['center', 'side', 'love', 'up', 'Поступок, показывающий, что он понимает центр лучше соперника'],
      ['center', 'side', 'trust', 'down', 'Давит, требует выбора, ставит ультиматум'],
    ],
  },
  {
    id: 'rivals-for-attention', label: 'Соперничество за внимание',
    description: 'Не романтическое соперничество за внимание и признание центра.',
    goal: 'Соперники проходят путь от борьбы за внимание центра к признанию друг друга.',
    factors: [
      ['side', 'rival', 'hostility', 'up', 'Соперник перехватывает внимание центра'],
      ['side', 'rival', 'respect', 'up', 'Соперник побеждает честно'],
      ['side', 'center', 'affection', 'up', 'Центр замечает и хвалит его'],
      ['side', 'center', 'resentment', 'up', 'Центр не замечает его стараний'],
      ['center', 'side', 'approval', 'up', 'Ведёт себя достойно в соперничестве'],
    ],
  },
  {
    id: 'united-front', label: 'Двое как одно целое',
    description: 'Две стороны действуют сообща, дополняют друг друга и делят связь с центром без ревности.',
    goal: 'Двое становятся для центра единым целым: дополняют друг друга, а не соперничают; связь троих держится на доверии, без ревности.',
    factors: [
      ['side', 'rival', 'trust', 'up', 'Прикрывает и дополняет действия другого'],
      ['side', 'rival', 'friendship', 'up', 'Общий план, слаженность без слов'],
      ['side', 'rival', 'jealousy', 'down', 'Центр уделяет внимание другому — радуется, а не ревнует'],
      ['side', 'rival', 'trust', 'down', 'Действует за спиной другого'],
      ['side', 'center', 'affection', 'up', 'Центр принимает их обоих, не выбирая одного'],
      ['side', 'center', 'trust', 'up', 'Центр не стравливает их между собой'],
      ['center', 'side', 'trust', 'up', 'Двое действуют слаженно ради центра'],
    ],
  },
  {
    id: 'found-family', label: 'Трое против мира',
    description: 'Трое становятся друг другу семьёй и держатся вместе против всех.',
    goal: 'Трое становятся друг другу семьёй: доверяют без оглядки и держатся вместе.',
    factors: [
      ['side', 'center', 'friendship', 'up', 'Общие испытания, пройденные вместе'],
      ['center', 'side', 'trust', 'up', 'Держит сторону своих перед чужими'],
      ['side', 'rival', 'friendship', 'up', 'Помогает другому, когда центра нет рядом'],
      ['side', 'rival', 'trust', 'down', 'Скрывает от остальных важное'],
      ['center', 'side', 'affection', 'up', 'Маленькие ритуалы, которые есть только у них троих'],
    ],
  },
];

export const PACE_LABELS = Object.freeze({ fast: 'быстро', slow: 'медленно' });

export function pairTropes() {
  return PAIR_TROPES.map(({ id, label, description, pace }) => ({ id, label, description, pace: { ...(pace ?? {}) } }));
}

export function triangleTropes() {
  return TRIANGLE_TROPES.map(({ id, label, description, goal }) => ({ id, label, description, goal }));
}

/** Factors of a pair trope for one directed line; scales missing from the chat are skipped. */
export function pairTropeFactors(tropeId, scaleIds) {
  const trope = PAIR_TROPES.find(item => item.id === tropeId);
  if (!trope) throw new Error('Троп не найден.');
  const known = new Set(scaleIds);
  return trope.factors
    .filter(([scaleId]) => known.has(scaleId))
    .map(([scaleId, direction, text]) => ({ scaleId, direction, text }));
}

/** Pace a pair trope sets on a line, limited to scales the chat has. */
export function pairTropePace(tropeId, scaleIds) {
  const trope = PAIR_TROPES.find(item => item.id === tropeId);
  if (!trope) throw new Error('Троп не найден.');
  const known = new Set(scaleIds);
  return Object.fromEntries(Object.entries(trope.pace ?? {}).filter(([scaleId]) => known.has(scaleId)));
}

/**
 * Expand a triangle trope to directed lines.
 * Returns { goal, factors: [{ from, to, scaleId, direction, text }] }; lines whose
 * subject is the persona are skipped (the persona's own feelings are not tracked).
 */
export function triangleTropeFactors(tropeId, triangle, scaleIds, personaId = '') {
  const trope = TRIANGLE_TROPES.find(item => item.id === tropeId);
  if (!trope) throw new Error('Троп не найден.');
  const known = new Set(scaleIds);
  const sides = [triangle.firstId, triangle.secondId];
  const factors = [];
  for (const [fromRole, toRole, scaleId, direction, text] of trope.factors) {
    if (!known.has(scaleId)) continue;
    for (const side of sides) {
      const rival = side === sides[0] ? sides[1] : sides[0];
      const resolve = role => (role === 'center' ? triangle.centerId : role === 'side' ? side : rival);
      const from = resolve(fromRole);
      const to = resolve(toRole);
      if (from === to || (personaId && from === personaId)) continue;
      if (factors.some(factor => factor.from === from && factor.to === to && factor.scaleId === scaleId && factor.direction === direction && factor.text === text)) continue;
      factors.push({ from, to, scaleId, direction, text });
    }
  }
  return { goal: trope.goal, factors };
}

/** Name of a trope by a factor origin ("pair-trope:slowburn"), for badges in the editors. */
export function tropeLabel(origin) {
  const [kind, id] = String(origin ?? '').split(':');
  const list = kind === 'pair-trope' ? PAIR_TROPES : [...TRIANGLE_TROPES, ...PAIR_TROPES];
  return list.find(item => item.id === id)?.label ?? '';
}
