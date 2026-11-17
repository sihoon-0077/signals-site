import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // input.tsx와 같은 면·테두리. 포커스는 globals.css의 :focus-visible 테두리로 보인다(outline-none 금지).
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-inset px-3 py-2 text-base text-foreground transition-colors placeholder:text-tertiary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
