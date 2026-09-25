import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[rgb(var(--color-marca-rgb)/0.15)] text-[var(--color-marca)]',
        secondary: 'bg-gray-100 text-gray-600',
        destructive: 'bg-red-100 text-red-700',
        success: 'bg-green-100 text-green-700',
        outline: 'border border-current',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
