/** Ambient typing for DEV hooks installed by apps/web App.tsx (production helper). */
type MillqTerminalChronologyHooks = {
  allocateTerminalBusinessChronology: (input: {
    terminalId: string;
    timeZone: string;
    now?: Date;
  }) => Promise<{ businessDate: string; businessOrder: number }>;
  peekTerminalBusinessOrder: (terminalId: string, businessDate: string) => number;
};

interface Window {
  __millqTerminalChronology?: MillqTerminalChronologyHooks;
}
