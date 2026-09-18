export type GuestMenuPriceDto =
  | {
      status: 'AVAILABLE';
      amountMinor: string;
      currencyCode: string;
      minorUnitExponent: number;
    }
  | { status: 'UNAVAILABLE' };

export type GuestMenuItemDto = {
  publicItemRef: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  price: GuestMenuPriceDto;
};

export type GuestMenuCategoryDto = {
  publicCategoryRef: string;
  name: string;
  itemRefs: string[];
};

export type GuestMenuDto = {
  language: string;
  outlet: { name: string };
  brand: { name: string };
  tableLabel: string | null;
  categories: GuestMenuCategoryDto[];
  items: GuestMenuItemDto[];
};
