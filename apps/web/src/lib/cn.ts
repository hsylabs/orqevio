type Value = string | false | null | undefined | 0
export const cn = (...values: Value[]) => values.filter(Boolean).join(' ')
