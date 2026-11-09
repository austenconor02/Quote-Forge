"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleHelp, X } from "lucide-react";

const STORAGE_KEY = "quoteforge.owner.tutorial.v1";
const steps = [
  { target: "create-company", title: "Create a company", text: "Start here to set up a customer's quoting application." },
  { target: "upload-logo", title: "Add the company logo", text: "Enter the company name and upload its logo. Optional contact details are below." },
  { target: "choose-colors", title: "Choose their colors", text: "Set the three colors or sample the uploaded logo. The preview updates as you go." },
  { target: "preview-app", title: "Preview their application", text: "Check the desktop, mobile, and PDF views. Back keeps your changes." },
  { target: "assign-email", title: "Assign access", text: "Enter the customer's email, then send. If email is unavailable, save an unassigned draft." }
] as const;

type TutorialState = { version: 1; status: "active" | "completed" | "skipped"; step: number };
type TutorialContextValue = { active: boolean; restart: () => void };
type Rect = { top: number; left: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
const TutorialContext = createContext<TutorialContextValue | null>(null);

function isWizardPath(path: string) {
  return path === "/create-company" || /^\/companies\/[^/]+\/edit\/?$/.test(path);
}

function visibleTarget(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden") ?? null;
}

export function OwnerTutorialProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<TutorialState | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [resumeAtCreate, setResumeAtCreate] = useState(false);
  const [cardHeight, setCardHeight] = useState(218);
  const pathRef = useRef(pathname);
  const stateRef = useRef(state);
  const targetRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const pendingRequest = useRef<number | null>(null);
  pathRef.current = pathname;
  stateRef.current = state;
  const active = state?.status === "active";

  useEffect(() => {
    let initial: TutorialState = { version: 1, status: "active", step: 0 };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.version === 1 && ["active", "completed", "skipped"].includes(saved.status) && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < steps.length) initial = saved;
      }
    } catch { /* The walkthrough still works for this session if browser storage is unavailable. */ }
    setState(initial);
  }, []);

  useEffect(() => {
    if (!state) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Progress stays in memory. */ }
  }, [state]);

  const finish = useCallback((status: "completed" | "skipped") => {
    pendingRequest.current = null;
    setBlocked(false);
    setState(current => ({ version: 1, status, step: current?.step ?? 0 }));
  }, []);

  const restart = useCallback(() => {
    setBlocked(false);
    setState({ version: 1, status: "active", step: isWizardPath(pathRef.current) ? 1 : 0 });
    if (isWizardPath(pathRef.current)) window.dispatchEvent(new CustomEvent("quoteforge:tutorial-step", { detail: { wizardStep: 0 } }));
    else if (!["/", "/companies"].includes(pathRef.current)) router.push("/");
  }, [router]);

  useEffect(() => {
    const onWizardStep = (event: Event) => {
      const detail = (event as CustomEvent<{ step?: number; blocked?: boolean }>).detail;
      if (!stateRef.current || stateRef.current.status !== "active" || !Number.isInteger(detail?.step) || detail.step! < 0 || detail.step! > 3) return;
      setBlocked(detail.blocked === true);
      pendingRequest.current = null;
      setState(current => current?.status === "active" ? { ...current, step: detail.step! + 1 } : current);
    };
    const onSaved = () => { if (stateRef.current?.status === "active") finish("completed"); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && stateRef.current?.status === "active") finish("skipped"); };
    window.addEventListener("quoteforge:wizard-step-changed", onWizardStep);
    window.addEventListener("quoteforge:company-saved", onSaved);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("quoteforge:wizard-step-changed", onWizardStep);
      window.removeEventListener("quoteforge:company-saved", onSaved);
      window.removeEventListener("keydown", onKey);
    };
  }, [finish]);

  useEffect(() => {
    if (!active || !state) { setRect(null); return; }
    let frame = 0;
    let cancelled = false;
    let scrolledTarget: HTMLElement | null = null;
    const measure = () => {
      if (cancelled) return;
      let target = visibleTarget(`[data-tutorial="${steps[state.step].target}"]`);
      let resume = false;
      if (!target && isWizardPath(pathname) && state.step === 0) target = visibleTarget('[data-tutorial="upload-logo"]');
      if (!target && ["/", "/companies"].includes(pathname)) { target = visibleTarget('[data-tutorial="create-company"]'); resume = state.step > 0; }
      targetRef.current = target;
      setResumeAtCreate(current => current === resume ? current : resume);
      if (!target) { setRect(current => current === null ? current : null); return; }
      const bounds = target.getBoundingClientRect();
      if (scrolledTarget !== target && (bounds.bottom < 32 || bounds.top > window.innerHeight - 130)) {
        scrolledTarget = target;
        target.scrollIntoView({ block: "center", behavior: "instant" });
      }
      const next = target.getBoundingClientRect();
      const measured = { top: next.top, left: next.left, width: next.width, height: next.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      setRect(current => current && Object.keys(measured).every(key => current[key as keyof Rect] === measured[key as keyof Rect]) ? current : measured);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "data-wizard-step", "data-tutorial"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    measure();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [active, state?.step, pathname]);

  useEffect(() => {
    if (!active || !state || !isWizardPath(pathname)) return;
    // A direct visit may mount the wizard before the provider's event listeners.
    const timer = setTimeout(() => {
      const currentStep = document.querySelector<HTMLElement>("[data-wizard-step]")?.dataset.wizardStep;
      const step = Number(currentStep);
      if (currentStep !== undefined && Number.isInteger(step) && step >= 0 && step <= 3 && stateRef.current?.status === "active") setState(current => current && ({ ...current, step: step + 1 }));
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, active]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => setCardHeight(Math.ceil(card.getBoundingClientRect().height));
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    measure();
    return () => observer.disconnect();
  }, [active, state?.step, blocked, rect !== null]);

  function requestWizardStep(step: number, tutorialStep: number) {
    setBlocked(false);
    pendingRequest.current = tutorialStep;
    window.dispatchEvent(new CustomEvent("quoteforge:tutorial-step", { detail: { wizardStep: step } }));
    // Request acknowledgment is deliberate: the wizard owns validation and may refuse to advance.
  }

  function next() {
    if (!state) return;
    if (resumeAtCreate) { router.push("/create-company"); return; }
    if (state.step === steps.length - 1) { finish("completed"); return; }
    if (!isWizardPath(pathname)) { setState({ ...state, step: 1 }); router.push("/create-company"); return; }
    if (state.step === 0) { setState({ ...state, step: 1 }); return; }
    requestWizardStep(state.step, state.step + 1);
  }

  function previous() {
    if (!state || state.step === 0) return;
    if (!isWizardPath(pathname)) { setState({ ...state, step: state.step - 1 }); return; }
    if (state.step === 1) { setBlocked(false); setState({ ...state, step: 0 }); return; }
    requestWizardStep(state.step - 2, state.step - 1);
  }

  const item = state ? steps[state.step] : steps[0];
  const cardWidth = rect ? Math.min(332, rect.viewportWidth - 28) : 332;
  const approximateHeight = cardHeight;
  let top = rect ? rect.top + rect.height + 14 : 0;
  if (rect && top + approximateHeight > rect.viewportHeight - 12) top = rect.top - approximateHeight - 14;
  if (rect) top = Math.max(14, Math.min(top, rect.viewportHeight - approximateHeight - 14));
  const left = rect ? Math.max(14, Math.min(rect.left + rect.width - cardWidth, rect.viewportWidth - cardWidth - 14)) : 14;
  const highlightTop = rect ? Math.max(6, rect.top - 5) : 0;
  const highlightLeft = rect ? Math.max(6, rect.left - 5) : 0;
  const highlightWidth = rect ? Math.min(rect.width + 10, rect.viewportWidth - highlightLeft - 6) : 0;
  const highlightHeight = rect ? Math.max(0, Math.min(rect.height + 10 - Math.max(0, 6 - (rect.top - 5)), rect.viewportHeight - highlightTop - 6)) : 0;

  return <TutorialContext.Provider value={{ active, restart }}>{children}{active && state && rect && <div className="owner-tutorial-layer">
    <div className="owner-tutorial-highlight" aria-hidden="true" style={{ top: highlightTop, left: highlightLeft, width: highlightWidth, height: highlightHeight }}/>
    <section ref={cardRef} className="owner-tutorial-tooltip" role="dialog" aria-modal="false" aria-label="Owner setup tutorial" aria-describedby="owner-tutorial-description" style={{ top, left, width: cardWidth }}>
      <div className="owner-tutorial-top"><span>SETUP WALKTHROUGH <span>{state.step + 1} / {steps.length}</span></span><button type="button" onClick={() => finish("skipped")} aria-label="Close tutorial"><X size={15}/></button></div>
      <div className="owner-tutorial-progress" aria-label={`Tutorial step ${state.step + 1} of ${steps.length}`}>{steps.map((step, index) => <span key={step.target} className={index <= state.step ? "is-current" : ""}/>)}</div>
      <h2>{resumeAtCreate ? "Continue company setup" : item.title}</h2>
      <p id="owner-tutorial-description">{resumeAtCreate ? "Open company setup to continue your walkthrough. Your existing companies stay unchanged." : item.text}</p>
      {blocked && <p className="owner-tutorial-hint" role="status">Complete the highlighted step before continuing.</p>}
      <div className="owner-tutorial-actions"><button className="owner-tutorial-skip" type="button" onClick={() => finish("skipped")}>Skip Tutorial</button><div><button className="owner-tutorial-previous" type="button" onClick={previous} disabled={state.step === 0} aria-label="Previous tutorial step"><ArrowLeft size={13}/><span>Previous</span></button><button className="owner-tutorial-next" type="button" onClick={next}>{resumeAtCreate ? "Continue" : state.step === steps.length - 1 ? "Finish" : "Next"}{state.step === steps.length - 1 && !resumeAtCreate ? <Check size={13}/> : <ArrowRight size={13}/>}</button></div></div>
    </section>
  </div>}</TutorialContext.Provider>;
}

export function TutorialHelpButton() {
  const context = useContext(TutorialContext);
  if (!context) return null;
  return <button className="owner-tutorial-help" type="button" onClick={context.restart} aria-label="Help / Restart Tutorial" title="Help / Restart Tutorial"><CircleHelp size={17}/><span>Help</span></button>;
}

export function useOwnerTutorial() {
  const context = useContext(TutorialContext);
  if (!context) throw new Error("Owner tutorial context required");
  return context;
}
