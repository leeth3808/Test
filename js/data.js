/* 기본 운동 라이브러리 + 추천 루틴 (코드에 내장, 사용자가 복사해서 수정 가능) */

const CATEGORIES = ['가슴', '등', '하체', '어깨', '팔', '코어', '유산소'];

// id는 고정 문자열 → 데이터 백업/복원 시에도 안정적으로 연결됨
const DEFAULT_EXERCISES = [
  // 가슴
  ['bench', '벤치프레스', '가슴'], ['incline-bench', '인클라인 벤치프레스', '가슴'],
  ['db-bench', '덤벨 벤치프레스', '가슴'], ['incline-db', '인클라인 덤벨 프레스', '가슴'],
  ['dips', '딥스', '가슴'], ['chest-fly', '체스트 플라이 (머신)', '가슴'],
  ['cable-cross', '케이블 크로스오버', '가슴'], ['pushup', '푸시업', '가슴'],
  // 등
  ['deadlift', '데드리프트', '등'], ['pullup', '풀업', '등'], ['lat-pull', '랫풀다운', '등'],
  ['barbell-row', '바벨 로우', '등'], ['db-row', '덤벨 로우', '등'],
  ['cable-row', '시티드 케이블 로우', '등'], ['tbar-row', '티바 로우', '등'], ['face-pull', '페이스풀', '등'],
  // 하체
  ['squat', '스쿼트', '하체'], ['front-squat', '프론트 스쿼트', '하체'], ['leg-press', '레그프레스', '하체'],
  ['rdl', '루마니안 데드리프트', '하체'], ['lunge', '런지', '하체'],
  ['bss', '불가리안 스플릿 스쿼트', '하체'], ['leg-ext', '레그 익스텐션', '하체'],
  ['leg-curl', '레그 컬', '하체'], ['calf', '카프 레이즈', '하체'], ['hip-thrust', '힙 쓰러스트', '하체'],
  // 어깨
  ['ohp', '오버헤드 프레스', '어깨'], ['db-shoulder', '덤벨 숄더 프레스', '어깨'],
  ['lateral', '사이드 레터럴 레이즈', '어깨'], ['rear-delt', '리어 델트 플라이', '어깨'],
  ['upright-row', '업라이트 로우', '어깨'],
  // 팔
  ['bb-curl', '바벨 컬', '팔'], ['db-curl', '덤벨 컬', '팔'], ['hammer', '해머 컬', '팔'],
  ['pushdown', '트라이셉스 푸시다운', '팔'], ['skull', '라잉 트라이셉스 익스텐션', '팔'],
  ['oh-tri', '오버헤드 트라이셉스 익스텐션', '팔'],
  // 코어
  ['plank', '플랭크 (초)', '코어'], ['hlr', '행잉 레그 레이즈', '코어'], ['crunch', '크런치', '코어'],
  ['cable-crunch', '케이블 크런치', '코어'], ['ab-roll', '앱 롤아웃', '코어'],
  // 유산소 (웨이트 세션 중 마무리 유산소 등)
  ['row-erg', '로잉머신 (분)', '유산소'], ['bike', '실내 자전거 (분)', '유산소'], ['stairs', '천국의 계단 (분)', '유산소'],
].map(([id, name, category]) => ({ id, name, category, custom: false }));

// 세트 x 횟수 축약 헬퍼
const ex = (exId, sets, reps) => ({ exId, sets, reps });

const PRESET_ROUTINES = [
  // ----- 웨이트 -----
  { id: 'p-full-a', type: 'weight', group: '초보자 전신 (주 3회 A/B 번갈아)', name: '전신 A',
    desc: '처음 3개월에 추천. 복합 관절 위주로 전신을 고르게.',
    items: [ex('squat', 3, 8), ex('bench', 3, 8), ex('barbell-row', 3, 8), ex('ohp', 2, 10), ex('plank', 3, 30)] },
  { id: 'p-full-b', type: 'weight', group: '초보자 전신 (주 3회 A/B 번갈아)', name: '전신 B',
    desc: '데드리프트는 폼 우선, 무게는 천천히.',
    items: [ex('deadlift', 3, 5), ex('incline-db', 3, 10), ex('lat-pull', 3, 10), ex('lunge', 3, 10), ex('hlr', 3, 10)] },

  { id: 'p-5x5-a', type: 'weight', group: '5x5 스트렝스 (주 3회 A/B 번갈아)', name: '5x5 A',
    desc: '5세트를 모두 성공하면 다음 세션에 2.5kg 증량.',
    items: [ex('squat', 5, 5), ex('bench', 5, 5), ex('barbell-row', 5, 5)] },
  { id: 'p-5x5-b', type: 'weight', group: '5x5 스트렝스 (주 3회 A/B 번갈아)', name: '5x5 B',
    desc: '데드리프트는 1x5 (하체 피로 관리).',
    items: [ex('squat', 5, 5), ex('ohp', 5, 5), ex('deadlift', 1, 5)] },

  { id: 'p-push', type: 'weight', group: 'PPL 3분할 (주 3~6회)', name: 'Push (가슴·어깨·삼두)',
    desc: '미는 근육 위주.',
    items: [ex('bench', 4, 6), ex('incline-db', 3, 10), ex('ohp', 3, 8), ex('lateral', 3, 15), ex('pushdown', 3, 12)] },
  { id: 'p-pull', type: 'weight', group: 'PPL 3분할 (주 3~6회)', name: 'Pull (등·이두)',
    desc: '당기는 근육 위주.',
    items: [ex('deadlift', 3, 5), ex('pullup', 3, 8), ex('cable-row', 3, 10), ex('face-pull', 3, 15), ex('db-curl', 3, 12)] },
  { id: 'p-legs', type: 'weight', group: 'PPL 3분할 (주 3~6회)', name: 'Legs (하체)',
    desc: '하체 + 코어.',
    items: [ex('squat', 4, 6), ex('rdl', 3, 8), ex('leg-press', 3, 12), ex('leg-curl', 3, 12), ex('calf', 4, 15)] },

  { id: 'p-upper', type: 'weight', group: '상/하체 2분할 (주 4회)', name: '상체',
    desc: '러닝과 병행하기 좋은 분할.',
    items: [ex('bench', 4, 8), ex('barbell-row', 4, 8), ex('db-shoulder', 3, 10), ex('lat-pull', 3, 10), ex('hammer', 2, 12), ex('skull', 2, 12)] },
  { id: 'p-lower', type: 'weight', group: '상/하체 2분할 (주 4회)', name: '하체',
    desc: '러닝 강도 높은 날 전후로는 피하기.',
    items: [ex('squat', 4, 8), ex('rdl', 3, 10), ex('bss', 3, 10), ex('leg-ext', 3, 12), ex('calf', 3, 15), ex('ab-roll', 3, 10)] },

  { id: 'p-runner-str', type: 'weight', group: '러너용 보강 운동', name: '러너 근력 보강',
    desc: '부상 예방(무릎·발목·코어). 주 1~2회, 쉬운 러닝 후에.',
    items: [ex('bss', 3, 8), ex('rdl', 3, 8), ex('hip-thrust', 3, 10), ex('calf', 3, 15), ex('plank', 3, 45)] },

  // ----- 러닝 -----
  { id: 'r-walkrun', type: 'run', group: '런린이 시작하기', name: '걷기-달리기 인터벌',
    desc: '1분 달리기 + 2분 걷기 × 8회 (총 24분). 숨이 차지 않는 속도로. 주 3회.',
    run: { targetKm: 3, targetMin: 24 } },
  { id: 'r-easy', type: 'run', group: '기본 훈련', name: '이지런 5km',
    desc: '대화가 가능한 편한 속도(존2). 주간 거리의 80%를 이 강도로.',
    run: { targetKm: 5, targetMin: 35 } },
  { id: 'r-tempo', type: 'run', group: '기본 훈련', name: '템포런 6km',
    desc: '워밍업 1km → 약간 힘든 속도 4km → 쿨다운 1km.',
    run: { targetKm: 6, targetMin: 36 } },
  { id: 'r-interval', type: 'run', group: '기본 훈련', name: '인터벌 400m × 8',
    desc: '400m 빠르게 + 200m 조깅 회복 × 8. 앞뒤로 1km 워밍업/쿨다운.',
    run: { targetKm: 6.8, targetMin: 40 } },
  { id: 'r-lsd', type: 'run', group: '기본 훈련', name: 'LSD 10km+',
    desc: '느리고 길게. 주 1회, 지난주보다 10% 이내로만 늘리기.',
    run: { targetKm: 10, targetMin: 70 } },
];
