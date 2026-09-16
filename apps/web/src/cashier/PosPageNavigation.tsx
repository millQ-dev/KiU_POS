import type { ResolvedPosPage } from '../api/types.js';
import './PosPageNavigation.css';

type Props = {
  pages: ResolvedPosPage[];
  selectedPageId: string | null;
  onSelect: (pageId: string) => void;
};

export function PosPageNavigation({ pages, selectedPageId, onSelect }: Props) {
  if (pages.length === 0) {
    return (
      <nav className="pos-nav" aria-label="Menu pages">
        <p className="pos-nav__empty">No pages</p>
      </nav>
    );
  }
  return (
    <nav className="pos-nav" aria-label="Menu pages">
      <ul className="pos-nav__list">
        {pages.map((p) => {
          const selected = p.layoutPublicationPageId === selectedPageId;
          return (
            <li key={p.layoutPublicationPageId}>
              <button
                type="button"
                className={selected ? 'pos-nav__btn pos-nav__btn--selected' : 'pos-nav__btn'}
                aria-current={selected ? 'page' : undefined}
                onClick={() => onSelect(p.layoutPublicationPageId)}
              >
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
