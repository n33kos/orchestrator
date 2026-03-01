import { useState, useCallback } from 'react'

type Validator<T> = {
  [K in keyof T]?: (value: T[K], values: T) => string | undefined
}

interface FormState<T> {
  values: T
  errors: Partial<Record<keyof T, string>>
  touched: Partial<Record<keyof T, boolean>>
  isValid: boolean
}

/**
 * Generic form validation hook.
 * Validates fields on blur (touched) and on submit.
 */
export function useFormValidation<T extends Record<string, unknown>>(
  initialValues: T,
  validators: Validator<T>,
) {
  const [values, setValues] = useState<T>(initialValues)
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({})
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({})

  const validateField = useCallback((field: keyof T, val: T[keyof T]) => {
    const validator = validators[field]
    if (!validator) return undefined
    return (validator as (value: T[keyof T], values: T) => string | undefined)(val, values)
  }, [validators, values])

  const validateAll = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {}
    let valid = true
    for (const key of Object.keys(validators) as (keyof T)[]) {
      const error = validateField(key, values[key])
      if (error) {
        newErrors[key] = error
        valid = false
      }
    }
    setErrors(newErrors)
    return valid
  }, [validators, values, validateField])

  const setFieldValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [field]: value }))
    // Clear error when user types
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }, [errors])

  const setFieldTouched = useCallback((field: keyof T) => {
    setTouched(prev => ({ ...prev, [field]: true }))
    const error = validateField(field, values[field])
    if (error) {
      setErrors(prev => ({ ...prev, [field]: error }))
    } else {
      setErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }, [values, validateField])

  const reset = useCallback(() => {
    setValues(initialValues)
    setErrors({})
    setTouched({})
  }, [initialValues])

  const isValid = Object.keys(errors).length === 0

  const state: FormState<T> = { values, errors, touched, isValid }

  return {
    ...state,
    setFieldValue,
    setFieldTouched,
    validateAll,
    reset,
  }
}
