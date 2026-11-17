import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // 입력칸은 페이지보다 한 단 어두운 면(inset) + 3:1 이상 테두리(input). 포커스는 globals.css의 :focus-visible 테두리로 보인다(outline-none 금지).
        // 높이: 휴대폰 44px(터치 목표) → sm 이상 40px. 글자 16px(휴대폰, iOS 확대 방지) → md 이상 14px.
        "h-11 w-full min-w-0 rounded-lg border border-input bg-inset px-3 py-1 text-base text-foreground transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-tertiary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm sm:h-10",
        className
      )}
      {...props}
    />
  )
}

export { Input }
