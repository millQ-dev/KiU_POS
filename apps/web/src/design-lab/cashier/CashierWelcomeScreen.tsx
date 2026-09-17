import type { CashierContext } from '../../api/types.js';
import './CashierWelcomeScreen.css';

export type WelcomeLanguage = 'ru' | 'en' | 'vi';

type Copy = {
  mark: string;
  title: string;
  lead: string;
  sequence: string[];
  context: string;
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
    mark: 'KiU · касса',
    title: 'Готовы к рабочему дню',
    lead: 'Counter-service касса для быстрого и точного заказа навынос.',
    sequence: ['Заказ', 'Модификаторы', 'Оплата', 'Кухня'],
    context: 'Рабочий контекст',
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
    mark: 'KiU · cashier',
    title: 'Ready for service',
    lead: 'A counter-service cashier for fast, accurate takeaway orders.',
    sequence: ['Order', 'Modifiers', 'Payment', 'Kitchen'],
    context: 'Working context',
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
    mark: 'KiU · thu ngân',
    title: 'Sẵn sàng phục vụ',
    lead: 'Quầy thu ngân phục vụ nhanh và chính xác cho đơn mang đi.',
    sequence: ['Đơn hàng', 'Tùy chọn', 'Thanh toán', 'Bếp'],
    context: 'Ngữ cảnh làm việc',
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
  const languages: Array<[WelcomeLanguage, string]> = [
    ['ru', 'RU'],
    ['en', 'EN'],
    ['vi', 'VI'],
  ];

  return (
    <main className="kiu-welcome" aria-label={text.title}>
      <div className="kiu-welcome__frame">
        <section className="kiu-welcome__intro">
          <div className="kiu-welcome__mark">{text.mark}</div>
          <h1 className="kiu-welcome__title">{text.title}</h1>
          <p className="kiu-welcome__lead">{text.lead}</p>
          <ul className="kiu-welcome__sequence" aria-label="Cashier flow">
            {text.sequence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="kiu-welcome__panel" aria-label={text.context}>
          <header className="kiu-welcome__panel-header">
            <div>
              <p className="kiu-welcome__eyebrow">{text.context}</p>
              <h2 className="kiu-welcome__panel-title">{context.outletName}</h2>
            </div>
            <span className="kiu-welcome__fixture">{text.fixture}</span>
          </header>

          <dl className="kiu-welcome__context">
            <div>
              <dt>{text.outlet}</dt>
              <dd>{context.outletName}</dd>
            </div>
            <div>
              <dt>{text.terminal}</dt>
              <dd>{context.deviceId}</dd>
            </div>
            <div>
              <dt>{text.shift}</dt>
              <dd>{text.open}</dd>
            </div>
            <div>
              <dt>{text.cashier}</dt>
              <dd>{context.cashierId.slice(0, 8)}</dd>
            </div>
          </dl>

          <div>
            <p className="kiu-welcome__language-label">{text.language}</p>
            <div className="kiu-welcome__languages" role="group" aria-label={text.language}>
              {languages.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="kiu-welcome__language"
                  data-selected={language === value}
                  aria-pressed={language === value}
                  onClick={() => onLanguageChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className="kiu-welcome__continue" onClick={onContinue}>
            {text.continue}
          </button>
          <p className="kiu-welcome__note">{text.note}</p>
        </section>
      </div>
    </main>
  );
}
