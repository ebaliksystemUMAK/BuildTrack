import { useState } from "react"
import Icon from "./Icons"

type FieldIcon = "building" | "phone" | "mail" | "user" | "lock" | "shield"

type FormFieldProps = {
  label: string
  placeholder: string
  type?: string
  icon: FieldIcon
  name: string
  autoComplete?: string
  minLength?: number
  disabled?: boolean
  onChange?: (value: string) => void
  // Optional: a controlled value (e.g. a phone number cleaned while typing), the phone keypad and a length limit.
  value?: string
  inputMode?: "numeric" | "tel" | "email" | "text"
  maxLength?: number
}

export default function FormField({
  label,
  placeholder,
  type = "text",
  icon,
  name,
  autoComplete,
  minLength,
  disabled,
  onChange,
  value,
  inputMode,
  maxLength,
}: FormFieldProps) {
  const [showPassword, setShowPassword] = useState(false)
  const isPassword = type === "password"

  return (
    <label className="form-field">
      <span>{label}</span>
      <span className="input-shell">
        <Icon name={icon} />
        <input
          name={name}
          type={isPassword && showPassword ? "text" : type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          disabled={disabled}
          value={value}
          inputMode={inputMode}
          maxLength={maxLength}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          required
        />
        {isPassword && (
          <button
            className="password-toggle"
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
          >
            <Icon name="eye" />
          </button>
        )}
      </span>
    </label>
  )
}
