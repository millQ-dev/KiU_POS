import type { ResolvedPosSlot } from '../api/types.js';
import { ProductTile } from './ProductTile.js';
import './QuickAccess.css';

type Props = {
  slots: ResolvedPosSlot[];
  selectingSlotId: string | null;
  onSelect: (slot: ResolvedPosSlot) => void;
};

export function QuickAccess({ slots, selectingSlotId, onSelect }: Props) {
  return (
    <section className="pos-qa" aria-label="Quick access">
      <h2 className="pos-qa__title">Quick access</h2>
      {slots.length === 0 ? (
        <p className="pos-qa__empty">No quick access pins</p>
      ) : (
        <div className="pos-qa__grid">
          {slots.map((slot) => (
            <ProductTile
              key={slot.layoutPublicationSlotId}
              slot={slot}
              busy={selectingSlotId === slot.layoutPublicationSlotId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
