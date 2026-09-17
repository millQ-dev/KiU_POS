export type PosLanguage = 'en' | 'ru' | 'vi';

export const POS_COPY_KEYS = [
  'customizeItem', 'close', 'required', 'optional', 'chooseRequired', 'cancel',
  'addToOrder', 'paymentAccepted', 'cash', 'received', 'change', 'orderState',
  'kitchen', 'inProgress', 'noProductionItems', 'receiptPreview', 'due',
  'cashReceived', 'receivedMustCover', 'takeCashAndSubmit', 'paymentNote', 'total', 'cashSuccessFeedback',
] as const;

export type PosCopyKey = (typeof POS_COPY_KEYS)[number];

const copy: Record<PosLanguage, Record<PosCopyKey, string>> = {
  en: {
    customizeItem: 'Customize item', close: 'Close', required: 'Required', optional: 'Optional',
    chooseRequired: 'Choose the required options before adding the item.', cancel: 'Cancel', addToOrder: 'Add to order',
    paymentAccepted: 'Payment accepted', cash: 'Cash', received: 'Received', change: 'Change', orderState: 'Order state',
    kitchen: 'Kitchen', inProgress: 'In progress', noProductionItems: 'No production items', receiptPreview: 'Receipt preview',
    due: 'Due', cashReceived: 'Cash received (VND)', receivedMustCover: 'Received cash must cover the Customer Payable.',
    takeCashAndSubmit: 'Take cash and submit order', paymentNote: 'Payment is recorded separately. The order is submitted after successful cash acceptance; kitchen tasks are created from Order Submitted.', total: 'Total', cashSuccessFeedback: 'Cash accepted. Order submitted; production tasks created.',
  },
  ru: {
    customizeItem: 'Настроить позицию', close: 'Закрыть', required: 'Обязательно', optional: 'Необязательно',
    chooseRequired: 'Выберите обязательные параметры перед добавлением позиции.', cancel: 'Отмена', addToOrder: 'Добавить в заказ',
    paymentAccepted: 'Оплата принята', cash: 'Наличные', received: 'Получено', change: 'Сдача', orderState: 'Состояние заказа',
    kitchen: 'Кухня', inProgress: 'В работе', noProductionItems: 'Кухонных позиций нет', receiptPreview: 'Предпросмотр чека',
    due: 'К оплате', cashReceived: 'Получено наличными (VND)', receivedMustCover: 'Сумма наличных должна покрывать сумму к оплате.',
    takeCashAndSubmit: 'Принять наличные и отправить заказ', paymentNote: 'Оплата записывается отдельно. После успешного приёма наличных заказ отправляется; кухонные задачи создаются из события отправки заказа.', total: 'Итого', cashSuccessFeedback: 'Наличные приняты. Заказ отправлен, кухонные задачи созданы.',
  },
  vi: {
    customizeItem: 'Tùy chỉnh món', close: 'Đóng', required: 'Bắt buộc', optional: 'Tùy chọn',
    chooseRequired: 'Chọn tùy chọn bắt buộc trước khi thêm món.', cancel: 'Hủy', addToOrder: 'Thêm vào đơn',
    paymentAccepted: 'Đã nhận thanh toán', cash: 'Tiền mặt', received: 'Đã nhận', change: 'Tiền thừa', orderState: 'Trạng thái đơn',
    kitchen: 'Bếp', inProgress: 'Đang thực hiện', noProductionItems: 'Không có món cần chế biến', receiptPreview: 'Xem trước hóa đơn',
    due: 'Cần thu', cashReceived: 'Tiền mặt nhận (VND)', receivedMustCover: 'Số tiền nhận phải đủ số tiền khách cần thanh toán.',
    takeCashAndSubmit: 'Nhận tiền và gửi đơn', paymentNote: 'Khoản thanh toán được ghi nhận riêng. Đơn được gửi sau khi nhận tiền mặt thành công; tác vụ bếp được tạo từ sự kiện gửi đơn.', total: 'Tổng cộng', cashSuccessFeedback: 'Đã nhận tiền mặt. Đơn đã được gửi và tác vụ bếp đã được tạo.',
  },
};

export function posCopy(language: PosLanguage | undefined, key: PosCopyKey): string {
  return copy[language ?? 'en'][key];
}
