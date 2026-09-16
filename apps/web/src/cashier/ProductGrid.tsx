import type { ResolvedPosSlot } from '../api/types.js';
import { ProductTile } from './ProductTile.js';
import './ProductGrid.css';

type Props = {
  slots: ResolvedPosSlot[];
  selectingSlotId: string | null;
  onSelect: (slot: ResolvedPosSlot) => void;
};

export function ProductGrid({ slots, selectingSlotId, onSelect }: Props) {
  if (slots.length === 0) {
    return (
      <div className="pos-grid pos-grid--empty" role="status">
        No items on this page
      </div>
    );
  }
  return (
    <div className="pos-grid" role="list">
      {slots.map((slot) => (
        <div key={slot.layoutPublicationSlotId} role="listitem">
          <ProductTile
            slot={slot}
            busy={selectingSlotId === slot.layoutPublicationSlotId}
            onSelect={onSelect}
          />
        </div>
      ))}
    </div>
  );
}
