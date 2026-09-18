import type { CashierContext } from '../../api/types.js';
import './CashierWelcomeScreen.css';

export type WelcomeLanguage = 'ru' | 'en' | 'vi';

type Copy = {
  title: string;
  lead: string;
  context: string;
  contextPrompt: string;
  outlet: string;
  terminal: string;
  cashier: string;
  shift: string;
  open: string;
  language: string;
  continue: string;
  fixture: string;
  note: string;
};

const copy: Record<WelcomeLanguage, Copy> = {
  ru: {
    title: 'Готовы к рабочему дню',
    lead: 'Передовая система учета и сервиса для работы кафе и ресторанов на базе ИИ',
    context: 'Рабочий контекст',
    contextPrompt: 'Проверьте рабочий контекст',
    outlet: 'Точка',
    terminal: 'Терминал',
    cashier: 'Кассир',
    shift: 'Смена',
    open: 'Открыта',
    language: 'Язык интерфейса',
    continue: 'Открыть кассу',
    fixture: 'Preview fixture',
    note: 'Дизайн-лаборатория: контекст подготовлен фикстурой. Production auth и UI смены сюда не добавляются.',
  },
  en: {
    title: 'Ready for service',
    lead: 'An advanced AI-powered system for accounting and service in cafés and restaurants.',
    context: 'Working context',
    contextPrompt: 'Check the working context',
    outlet: 'Outlet',
    terminal: 'Terminal',
    cashier: 'Cashier',
    shift: 'Shift',
    open: 'Open',
    language: 'Interface language',
    continue: 'Open cashier',
    fixture: 'Preview fixture',
    note: 'Design lab only: this context comes from a fixture. Production auth and shift UI are not added here.',
  },
  vi: {
    title: 'Sẵn sàng phục vụ',
    lead: 'Hệ thống quản lý và dịch vụ tiên tiến cho quán cà phê và nhà hàng trên nền tảng AI.',
    context: 'Ngữ cảnh làm việc',
    contextPrompt: 'Kiểm tra ngữ cảnh làm việc',
    outlet: 'Cửa hàng',
    terminal: 'Thiết bị',
    cashier: 'Thu ngân',
    shift: 'Ca làm việc',
    open: 'Đang mở',
    language: 'Ngôn ngữ giao diện',
    continue: 'Mở quầy thu ngân',
    fixture: 'Preview fixture',
    note: 'Chỉ dành cho design lab: ngữ cảnh được tạo từ fixture. Không thêm xác thực production hoặc giao diện ca làm việc.',
  },
};

type Props = {
  context: CashierContext;
  language: WelcomeLanguage;
  onLanguageChange: (language: WelcomeLanguage) => void;
  onContinue: () => void;
};

export function CashierWelcomeScreen({ context, language, onLanguageChange, onContinue }: Props) {
  const text = copy[language];

  return (
    <main className="kiu-welcome" aria-label={text.title}>
      <div className="kiu-welcome__frame">
        <section className="kiu-welcome__intro">
          <div className="kiu-welcome__intro-topline">
            <span className="kiu-welcome__logo">
              <img src="/brand/kiu-logo-transparent.png" alt="KiU" draggable="false" />
            </span>
            <label className="kiu-welcome__locale">
              <span className="kiu-welcome__globe" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z" /></svg>
              </span>
              <span className="sr-only">{text.language}</span>
              <select value={language} aria-label={text.language} onChange={(event) => onLanguageChange(event.target.value as WelcomeLanguage)}>
                <option value="ru">RU</option>
                <option value="en">EN</option>
                <option value="vi">VI</option>
              </select>
              <span className="kiu-welcome__select-chevron" aria-hidden="true">⌄</span>
            </label>
          </div>
          <h1 className="kiu-welcome__title">{text.title}</h1>
          <p className="kiu-welcome__lead">{text.lead}</p>
        </section>

        <section className="kiu-welcome__panel" aria-label={text.context}>
          <header className="kiu-welcome__panel-header">
            <div>
              <p className="kiu-welcome__eyebrow">{text.contextPrompt}</p>
              <h2 className="kiu-welcome__panel-title">{context.outletName}</h2>
            </div>
            <span className="kiu-welcome__fixture">{text.fixture}</span>
          </header>

          <dl className="kiu-welcome__context">
            <div>
              <dt><span>{text.outlet}</span><span className="kiu-welcome__context-chevron" aria-hidden="true">⌄</span></dt>
              <dd>{context.outletName}</dd>
            </div>
            <div>
              <dt><span>{text.terminal}</span><span className="kiu-welcome__context-chevron" aria-hidden="true">⌄</span></dt>
              <dd>{context.deviceId}</dd>
            </div>
            <div>
              <dt><span>{text.shift}</span><span className="kiu-welcome__context-chevron" aria-hidden="true">⌄</span></dt>
              <dd>{text.open}</dd>
            </div>
            <div>
              <dt><span>{text.cashier}</span><span className="kiu-welcome__context-chevron" aria-hidden="true">⌄</span></dt>
              <dd>{context.cashierId.slice(0, 8)}</dd>
            </div>
          </dl>

          <button type="button" className="kiu-welcome__continue" onClick={onContinue}>
            {text.continue}
          </button>
          <p className="kiu-welcome__note">{text.note}</p>
        </section>
      </div>
    </main>
  );
}
