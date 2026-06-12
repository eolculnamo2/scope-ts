export type Type<Success, Fail = unknown> =
  | {
      success: true;
      value: Success;
    }
  | {
      success: false;
      reason: Fail;
    };

export const success = <S>(value: S): Type<S, never> => ({
  success: true,
  value,
});

export const fail = <R>(reason: R): Type<never, R> => ({
  success: false,
  reason,
});
