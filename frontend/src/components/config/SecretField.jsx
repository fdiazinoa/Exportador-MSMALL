import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import FormField, { inputBaseClassName } from './FormField'
import { cn } from '../../lib/cn'

export default function SecretField({
  label,
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
}) {
  const [visible, setVisible] = useState(false)

  return (
    <FormField label={label} className={className}>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={cn(inputBaseClassName, 'pr-11', inputClassName)}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition hover:text-gray-600"
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </FormField>
  )
}
