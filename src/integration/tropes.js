/**
 * Ready-made tropes: prewritten growth factors that need no model request.
 *
 * Pair tropes describe one directed line "subject → object". Triangle tropes
 * are written in roles — the center and the two sides — and expand to the
 * triangle's directed lines, with a suggested end point (goal).
 */
const PAIR_TROPES = [
  {
    id: 'slowburn', label: 'Слоуберн', factors: [
      ['affection', 'up', 'Долгие разговоры наедине, мелкая забота без повода'],
      ['trust', 'up', 'Держит обещания и хранит доверенные секреты'],
      ['attraction', 'up', 'Случайные прикосновения, задержавшийся взгляд'],
      ['love', 'up', 'Открывает уязвимость только ему'],
      ['love', 'down', 'Торопит события, давит на чувства'],
      ['trust', 'down', 'Нарушает личные границы'],
    ],
  },
  {
    id: 'enemies-to-lovers', label: 'От ненависти до любви', factors: [
      ['respect', 'up', 'Показывает силу или мастерство в столкновении'],
      ['hostility', 'down', 'Прикрывает спину в настоящей опасности'],
      ['attraction', 'up', 'Стычка перерастает в напряжённую близость'],
      ['trust', 'up', 'Вынужденное сотрудничество, в котором не предал'],
      ['resentment', 'down', 'Признаёт свою неправоту'],
      ['hostility', 'up', 'Унижает при свидетелях'],
    ],
  },
  {
    id: 'lovers-to-enemies', label: 'От любви до ненависти', factors: [
      ['resentment', 'up', 'Предаёт доверие или раскрывает тайну'],
      ['trust', 'down', 'Лжёт, действует из скрытых мотивов'],
      ['hostility', 'up', 'Встаёт на сторону врага или соперника'],
      ['love', 'down', 'Равнодушен к его боли'],
      ['affection', 'down', 'Пренебрегает им на людях'],
      ['jealousy', 'up', 'Сближается с соперником'],
    ],
  },
  {
    id: 'friends-to-lovers', label: 'Из друзей в возлюбленные', factors: [
      ['friendship', 'up', 'Общие шутки, привычки и маленькие традиции'],
      ['attraction', 'up', 'Видит его в новом свете: смелость, внешность, заботу'],
      ['jealousy', 'up', 'Кто-то другой проявляет к нему интерес'],
      ['love', 'up', 'Выбирает его в трудную минуту, а не других'],
      ['friendship', 'down', 'Неловкость и избегание после намёка на чувства'],
    ],
  },
  {
    id: 'forbidden', label: 'Запретная любовь', factors: [
      ['love', 'up', 'Тайные встречи вопреки запрету'],
      ['fear', 'up', 'Риск разоблачения, близкая угроза'],
      ['dependency', 'up', 'Только с ним можно быть собой'],
      ['guilt', 'up', 'Обманывает близких ради встреч'],
      ['trust', 'down', 'Скрывает правду, которая касается их обоих'],
    ],
  },
  {
    id: 'rivals-to-allies', label: 'Соперники → союзники', factors: [
      ['respect', 'up', 'Честная победа или достойное поражение'],
      ['hostility', 'down', 'Общая цель и общий враг'],
      ['trust', 'up', 'Прикрывает в бою или в споре'],
      ['approval', 'up', 'Разделяет его принципы'],
      ['respect', 'down', 'Жульничает или бьёт исподтишка'],
    ],
  },
  {
    id: 'protector', label: 'Защитник', factors: [
      ['trust', 'up', 'Защищает без просьбы'],
      ['affection', 'up', 'Заботится о ранах и усталости'],
      ['dependency', 'up', 'Решает его проблемы за него'],
      ['approval', 'down', 'Безрассудно рискует собой'],
      ['guilt', 'up', 'Не уберёг от беды'],
    ],
  },
  {
    id: 'second-chance', label: 'Второй шанс', factors: [
      ['guilt', 'up', 'Вспоминает, как когда-то ранил'],
      ['love', 'up', 'Общие воспоминания о лучшем времени'],
      ['resentment', 'down', 'Искреннее извинение без оправданий'],
      ['trust', 'up', 'Последовательно доказывает, что изменился'],
      ['trust', 'down', 'Повторяет старую ошибку'],
      ['resentment', 'up', 'Напоминание о прошлой боли'],
    ],
  },
];

/** Roles: center, side (either of the two), rival (the other side). */
const TRIANGLE_TROPES = [
  {
    id: 'love-triangle', label: 'Любовный треугольник: выбор',
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
    id: 'found-family', label: 'Трое против мира',
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

export function pairTropes() {
  return PAIR_TROPES.map(({ id, label }) => ({ id, label }));
}

export function triangleTropes() {
  return TRIANGLE_TROPES.map(({ id, label, goal }) => ({ id, label, goal }));
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
      if (factors.some(factor => factor.from === from && factor.to === to && factor.scaleId === scaleId && factor.direction === direction)) continue;
      factors.push({ from, to, scaleId, direction, text });
    }
  }
  return { goal: trope.goal, factors };
}
