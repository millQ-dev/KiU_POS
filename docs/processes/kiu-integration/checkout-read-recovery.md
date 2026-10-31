# Counter checkout recovery

If the cashier cannot read the order's settlement, keep the last known projection and lock order and checkout controls. Retry reads the Order, commercial status, and settlement; a confirmed absent settlement is different from a failed or invalid read. A successful read can unlock a read-only failure, subject to the live settlement's normal edit lock.

After an unconfirmed OpenSettlement or AbortSettlement response, the screen retains the lock even when subsequent reads succeed. A read is only a snapshot and can precede the original request's commit. The cashier can recheck, but the current API does not provide this UI with conclusive evidence that the specific command has finished. Confirmed pre-commit rejections are shown separately and do not become an indefinite unknown mutation.

This recovery state is currently in memory. Reloading or unmounting the shell loses it, and the shell does not yet resume the previous Order. A durable order/attempt recovery flow requires separate work and backend-owner coordination; do not treat a browser reload or a new order as proof that the original request did not commit.
