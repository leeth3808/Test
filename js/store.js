/* 데이터 저장소: 기기 localStorage에 JSON으로 저장 (서버 없음, 오프라인 동작) */

const STORE_KEY = 'fitlog.v1';

const DEFAULT_STATE = () => ({
  version: 1,
  settings: {
    bodyWeight: 70,      // kg, 칼로리 계산용
    restSeconds: 90,     // 기본 휴식 시간
    autoRest: true,      // 세트 완료 체크 시 휴식 타이머 자동 시작
    weekStart: 0,        // 0=일요일, 1=월요일
    weeklyGoal: 4,       // 주간 목표 운동일 수
    theme: 'auto',
  },
  customExercises: [],   // {id, name, category, custom:true}
  routines: [],          // 사용자 루틴 {id, type, name, desc, items|run}
  workouts: [],          // {id, date, type:'weight'|'run', title, memo, ...}
  bodyWeights: [],       // {date, kg}
});

const Store = {
  state: null,

  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      this.state = Object.assign(DEFAULT_STATE(), parsed || {});
      this.state.settings = Object.assign(DEFAULT_STATE().settings, (parsed && parsed.settings) || {});
    } catch (e) {
      console.error('데이터 로드 실패, 기본값 사용', e);
      this.state = DEFAULT_STATE();
    }
    return this.state;
  },

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
      return true;
    } catch (e) {
      console.error('저장 실패', e);
      alert('저장 공간이 부족하거나 저장이 차단되었습니다. 설정 > 백업으로 데이터를 내보내 주세요.');
      return false;
    }
  },

  // 백업 파일을 불러와 전체 교체 (형식 검증 포함)
  importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.workouts)) throw new Error('핏로그 백업 파일이 아닙니다.');
    const base = DEFAULT_STATE();
    this.state = Object.assign(base, data);
    this.state.settings = Object.assign(base.settings, data.settings || {});
    this.save();
  },

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  },

  reset() {
    this.state = DEFAULT_STATE();
    this.save();
  },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
