import * as React from "react"
import { cn } from "../../lib/utils"
import { Check } from "lucide-react"

const Checkbox = React.forwardRef(({ className, checked, onCheckedChange, disabled, ...props }, ref) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => !disabled && onCheckedChange?.(!checked)}
    className={cn(
      "h-5 w-5 shrink-0 rounded-md border border-[rgb(var(--color-marca-rgb)/0.2)] bg-white ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--color-marca)] data-[state=checked]:text-white",
      checked && "bg-[var(--color-marca)] text-white border-[var(--color-marca)]",
      className
    )}
    {...props}
    ref={ref}
  >
    {checked && (
      <span className="flex items-center justify-center text-current animate-in zoom-in-50 duration-200">
        <Check className="h-3.5 w-3.5 stroke-[3]" />
      </span>
    )}
  </button>
))
Checkbox.displayName = "Checkbox"

export { Checkbox }
