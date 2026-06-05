"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "english-shadowing-study:v1";

type StoredStudy = {
  text: string;
  speed: number;
  repeatCount: number;
  learnedSentences: string[];
};

type SpokenHighlight = {
  sentenceIndex: number;
  start: number;
  end: number;
} | null;

type TranslationItem = {
  error?: string;
  loading: boolean;
  text?: string;
  visible: boolean;
};

type MyMemoryResponse = {
  responseData?: {
    translatedText?: string;
  };
};

type StudyAction =
  | {
      type: "hydrate";
      payload: StoredStudy;
    }
  | {
      type: "setText";
      payload: string;
    }
  | {
      type: "setSpeed";
      payload: number;
    }
  | {
      type: "setRepeatCount";
      payload: number;
    }
  | {
      type: "setLearnedSentences";
      payload: (current: string[]) => string[];
    };

const sampleText =
  "Small steps make real progress. Listen carefully, speak slowly, and repeat with confidence! What sentence would you like to master today?";

const defaultStudy: StoredStudy = {
  text: sampleText,
  speed: 0.9,
  repeatCount: 3,
  learnedSentences: [],
};

function readStoredStudy(): StoredStudy {
  if (typeof window === "undefined") return defaultStudy;

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultStudy;

  try {
    const parsed = JSON.parse(saved) as Partial<StoredStudy>;

    return {
      text: parsed.text || defaultStudy.text,
      speed: typeof parsed.speed === "number" ? parsed.speed : defaultStudy.speed,
      repeatCount:
        typeof parsed.repeatCount === "number"
          ? parsed.repeatCount
          : defaultStudy.repeatCount,
      learnedSentences: Array.isArray(parsed.learnedSentences)
        ? parsed.learnedSentences
        : defaultStudy.learnedSentences,
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return defaultStudy;
  }
}

function studyReducer(state: StoredStudy, action: StudyAction): StoredStudy {
  switch (action.type) {
    case "hydrate":
      return action.payload;
    case "setText":
      return {
        ...state,
        text: action.payload,
      };
    case "setSpeed":
      return {
        ...state,
        speed: action.payload,
      };
    case "setRepeatCount":
      return {
        ...state,
        repeatCount: action.payload,
      };
    case "setLearnedSentences":
      return {
        ...state,
        learnedSentences: action.payload(state.learnedSentences),
      };
    default:
      return state;
  }
}

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function subscribeToSpeechSupport() {
  return () => {};
}

function getSpeechSupportSnapshot() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function getServerSpeechSupportSnapshot() {
  return false;
}

function getWordRange(sentence: string, charIndex: number) {
  const startIndex = clamp(charIndex, 0, Math.max(sentence.length - 1, 0));
  const rest = sentence.slice(startIndex);
  const match = rest.match(/[A-Za-z0-9']+/);

  if (!match || match.index === undefined) {
    return {
      start: startIndex,
      end: Math.min(startIndex + 1, sentence.length),
    };
  }

  const start = startIndex + match.index;
  return {
    start,
    end: start + match[0].length,
  };
}

function renderSentence(
  sentence: string,
  index: number,
  spokenHighlight: SpokenHighlight,
) {
  if (!spokenHighlight || spokenHighlight.sentenceIndex !== index) {
    return sentence;
  }

  const start = clamp(spokenHighlight.start, 0, sentence.length);
  const end = clamp(spokenHighlight.end, start, sentence.length);

  return (
    <>
      <span className="font-semibold text-cyan-700 transition-colors">
        {sentence.slice(0, start)}
      </span>
      <span className="font-extrabold text-rose-600 transition-colors">
        {sentence.slice(start, end)}
      </span>
      {sentence.slice(end)}
    </>
  );
}

export default function Home() {
  const [study, dispatchStudy] = useReducer(studyReducer, defaultStudy);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<"single" | "all" | null>(null);
  const [spokenHighlight, setSpokenHighlight] = useState<SpokenHighlight>(null);
  const [translations, setTranslations] = useState<Record<string, TranslationItem>>(
    {},
  );
  const speechReady = useSyncExternalStore(
    subscribeToSpeechSupport,
    getSpeechSupportSnapshot,
    getServerSpeechSupportSnapshot,
  );
  const cancelRef = useRef(false);
  const skipInitialSaveRef = useRef(true);
  const { learnedSentences, repeatCount, speed, text } = study;

  const sentences = useMemo(() => splitSentences(text), [text]);
  const safeCurrentIndex = clamp(currentIndex, 0, Math.max(sentences.length - 1, 0));
  const totalCharacters = text.trim().length;

  useEffect(() => {
    dispatchStudy({
      type: "hydrate",
      payload: readStoredStudy(),
    });
  }, []);

  useEffect(() => {
    if (skipInitialSaveRef.current) {
      skipInitialSaveRef.current = false;
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(study));
  }, [study]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const markLearned = useCallback((sentence: string) => {
    dispatchStudy({
      type: "setLearnedSentences",
      payload: (current) => {
        if (!sentence || current.includes(sentence)) return current;
        return [sentence, ...current].slice(0, 60);
      },
    });
  }, []);

  const speakOnce = useCallback(
    (sentence: string, sentenceIndex: number) =>
      new Promise<void>((resolve) => {
        if (!sentence || !window.speechSynthesis) {
          resolve();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.lang = "en-US";
        utterance.rate = speed;
        utterance.pitch = 1;
        setSpokenHighlight({
          sentenceIndex,
          start: 0,
          end: 0,
        });
        utterance.onboundary = (event) => {
          const range = getWordRange(sentence, event.charIndex);
          setSpokenHighlight({
            sentenceIndex,
            ...range,
          });
        };
        utterance.onend = () => {
          setSpokenHighlight({
            sentenceIndex,
            start: sentence.length,
            end: sentence.length,
          });
          resolve();
        };
        utterance.onerror = () => {
          setSpokenHighlight(null);
          resolve();
        };
        window.speechSynthesis.speak(utterance);
      }),
    [speed],
  );

  const stopPlayback = useCallback(() => {
    cancelRef.current = true;
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setMode(null);
    setSpokenHighlight(null);
  }, []);

  const toggleTranslation = useCallback(async (sentence: string) => {
    const current = translations[sentence];

    if (current?.text || current?.loading) {
      setTranslations((items) => ({
        ...items,
        [sentence]: {
          ...items[sentence],
          visible: !items[sentence]?.visible,
        },
      }));
      return;
    }

    setTranslations((items) => ({
      ...items,
      [sentence]: {
        loading: true,
        visible: true,
      },
    }));

    try {
      const response = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
          sentence,
        )}&langpair=en|ko`,
      );

      if (!response.ok) {
        throw new Error("translation-request-failed");
      }

      const data = (await response.json()) as MyMemoryResponse;
      const translatedText = data.responseData?.translatedText?.trim();

      if (!translatedText) {
        throw new Error("translation-empty");
      }

      setTranslations((items) => ({
        ...items,
        [sentence]: {
          loading: false,
          text: translatedText,
          visible: true,
        },
      }));
    } catch {
      setTranslations((items) => ({
        ...items,
        [sentence]: {
          error: "번역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          loading: false,
          visible: true,
        },
      }));
    }
  }, [translations]);

  const playSentence = useCallback(
    async (index: number) => {
      if (!speechReady || !sentences[index]) return;

      cancelRef.current = false;
      setIsPlaying(true);
      setMode("single");
      setCurrentIndex(index);

      for (let count = 0; count < repeatCount; count += 1) {
        if (cancelRef.current) break;
        await speakOnce(sentences[index], index);
      }

      if (!cancelRef.current) {
        markLearned(sentences[index]);
        setIsPlaying(false);
        setMode(null);
        setSpokenHighlight(null);
      }
    },
    [markLearned, repeatCount, sentences, speakOnce, speechReady],
  );

  const playAll = useCallback(async () => {
    if (!speechReady || sentences.length === 0) return;

    cancelRef.current = false;
    setIsPlaying(true);
    setMode("all");

    for (let index = 0; index < sentences.length; index += 1) {
      setCurrentIndex(index);
      for (let count = 0; count < repeatCount; count += 1) {
        if (cancelRef.current) break;
        await speakOnce(sentences[index], index);
      }
      if (cancelRef.current) break;
      markLearned(sentences[index]);
    }

    if (!cancelRef.current) {
      setIsPlaying(false);
      setMode(null);
      setSpokenHighlight(null);
    }
  }, [markLearned, repeatCount, sentences, speakOnce, speechReady]);

  const resetLearned = () => {
    dispatchStudy({
      type: "setLearnedSentences",
      payload: () => [],
    });
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700">
              Shadowing Studio
            </p>
            <h1 className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">
              영어 문장을 듣고, 따라 말하고, 반복하세요
            </h1>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <p className="text-xs text-slate-500">문장</p>
              <p className="text-lg font-bold text-slate-950">{sentences.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <p className="text-xs text-slate-500">글자</p>
              <p className="text-lg font-bold text-slate-950">{totalCharacters}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <p className="text-xs text-slate-500">저장</p>
              <p className="text-lg font-bold text-slate-950">
                {learnedSentences.length}
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)]">
          <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-950">학습 문장 입력</h2>
              <button
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-cyan-300 hover:text-cyan-800"
                type="button"
                onClick={() => dispatchStudy({ type: "setText", payload: "" })}
              >
                비우기
              </button>
            </div>

            <textarea
              className="min-h-[260px] resize-y rounded-lg border border-slate-200 bg-slate-50 p-4 text-base leading-7 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100"
              placeholder="영어 문장을 입력하세요. 마침표, 물음표, 느낌표 기준으로 카드가 만들어집니다."
              value={text}
              onChange={(event) =>
                dispatchStudy({ type: "setText", payload: event.target.value })
              }
            />

            <div className="grid gap-4 rounded-lg bg-slate-50 p-4">
              <label className="grid gap-2">
                <span className="flex items-center justify-between text-sm font-semibold text-slate-700">
                  재생 속도
                  <span className="text-cyan-800">{speed.toFixed(1)}x</span>
                </span>
                <input
                  className="accent-cyan-700"
                  max="1.5"
                  min="0.5"
                  step="0.1"
                  type="range"
                  value={speed}
                  onChange={(event) =>
                    dispatchStudy({
                      type: "setSpeed",
                      payload: Number(event.target.value),
                    })
                  }
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-700">
                  반복 횟수
                </span>
                <input
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  max="10"
                  min="1"
                  type="number"
                  value={repeatCount}
                  onChange={(event) =>
                    dispatchStudy({
                      type: "setRepeatCount",
                      payload: clamp(Number(event.target.value), 1, 10),
                    })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                className="h-12 rounded-md bg-cyan-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-800 disabled:bg-slate-300"
                disabled={isPlaying || sentences.length === 0 || !speechReady}
                type="button"
                onClick={() => playSentence(safeCurrentIndex)}
              >
                현재 문장 반복
              </button>
              <button
                className="h-12 rounded-md bg-slate-950 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:bg-slate-300"
                disabled={isPlaying || sentences.length === 0 || !speechReady}
                type="button"
                onClick={playAll}
              >
                전체 순차 재생
              </button>
            </div>

            <button
              className="h-11 rounded-md border border-rose-200 bg-rose-50 px-4 text-sm font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
              disabled={!isPlaying}
              type="button"
              onClick={stopPlayback}
            >
              재생 중지
            </button>

            {!speechReady && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                현재 브라우저에서 Web Speech API를 사용할 수 없습니다.
              </p>
            )}
          </div>

          <div className="flex min-h-[620px] flex-col rounded-lg border border-slate-200 bg-white shadow-soft">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">문장 카드</h2>
                <p className="text-sm text-slate-500">
                  카드를 선택한 뒤 현재 문장 반복으로 집중 연습할 수 있어요.
                </p>
              </div>
              <div className="rounded-full bg-cyan-50 px-3 py-1 text-sm font-semibold text-cyan-800">
                {mode === "all"
                  ? "전체 재생 중"
                  : mode === "single"
                    ? "반복 재생 중"
                    : "대기 중"}
              </div>
            </div>

            <div className="grid gap-3 overflow-y-auto p-4">
              {sentences.length > 0 ? (
                sentences.map((sentence, index) => {
                  const isActive = index === safeCurrentIndex;
                  const learned = learnedSentences.includes(sentence);
                  const translation = translations[sentence];

                  return (
                    <article
                      className={`rounded-lg border p-4 transition ${
                        isActive
                          ? "border-cyan-500 bg-cyan-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                      key={`${sentence}-${index}`}
                    >
                      <div className="flex gap-3">
                        <button
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-md text-sm font-bold ${
                            isActive
                              ? "bg-cyan-700 text-white"
                              : "bg-slate-100 text-slate-600"
                          }`}
                          type="button"
                          onClick={() => setCurrentIndex(index)}
                          aria-label={`${index + 1}번째 문장 선택`}
                        >
                          {index + 1}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-lg leading-8 text-slate-900">
                            {renderSentence(sentence, index, spokenHighlight)}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-400 hover:text-cyan-800 disabled:opacity-50"
                              disabled={isPlaying || !speechReady}
                              type="button"
                              onClick={() => playSentence(index)}
                            >
                              이 문장 듣기
                            </button>
                            <button
                              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-400 hover:text-cyan-800 disabled:opacity-50"
                              disabled={translation?.loading}
                              type="button"
                              onClick={() => toggleTranslation(sentence)}
                            >
                              {translation?.visible ? "번역 접기" : "번역하기"}
                            </button>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${
                                learned
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {learned ? "학습 저장됨" : "미학습"}
                            </span>
                          </div>
                          {translation?.visible && (
                            <div className="mt-3 rounded-lg border border-cyan-100 bg-white/75 p-3">
                              <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-700">
                                Korean Translation
                              </p>
                              <p className="mt-2 text-sm leading-6 text-slate-700">
                                {translation.loading
                                  ? "번역을 불러오는 중입니다..."
                                  : translation.error ?? translation.text}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="grid min-h-[380px] place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                  <p className="max-w-sm text-slate-500">
                    문장을 입력하면 이곳에 쉐도잉 카드가 생성됩니다.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-950">학습한 문장</h2>
              <p className="text-sm text-slate-500">
                재생이 완료된 문장은 브라우저 LocalStorage에 자동 저장됩니다.
              </p>
            </div>
            <button
              className="h-10 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
              disabled={learnedSentences.length === 0}
              type="button"
              onClick={resetLearned}
            >
              저장 목록 지우기
            </button>
          </div>

          {learnedSentences.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {learnedSentences.slice(0, 12).map((sentence) => (
                <span
                  className="max-w-full rounded-full bg-slate-100 px-3 py-2 text-sm text-slate-700"
                  key={sentence}
                >
                  {sentence}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
