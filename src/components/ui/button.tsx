import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// 포커스 표시는 globals.css의 :focus-visible 테두리(2px, 2px 띄움) 하나로 통일한다: 여기서 outline-none·ring을 쓰면 그 테두리가 지워진다.
const baseButtonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors duration-150 select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // elev-button(globals.css): 위쪽 1px 흰 하이라이트 + 바깥 1px 그림자. 주 버튼에만 둔다.
        default: "bg-primary text-primary-foreground elev-button hover:bg-primary-hover active:bg-primary-pressed",
        outline:
          "border-border bg-white/4 text-foreground hover:border-line-strong hover:bg-white/8 aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-selected aria-expanded:bg-selected",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        // 히어로·CTA·폼 제출: 휴대폰 44px(터치 목표), sm 이상 40px
        lg: "h-11 gap-2 px-5 text-[0.9375rem] sm:h-10 sm:px-4 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// cva는 기본·variant·size 클래스를 합치지 않고 이어 붙이기만 한다. 기본의 border-transparent·rounded-lg·text-sm이 outline·sm의
// 같은 속성 클래스와 함께 남으면 빌드된 CSS 순서로 승부가 나고, .border-transparent가 뒤에 있어 outline 테두리가 사라진다.
// 그래서 여기서 cn으로 한 번 합쳐 내보낸다: <Link className={buttonVariants(...)}>처럼 링크에 바로 써도 variant·size 쪽이 남는다.
function buttonVariants(props?: Parameters<typeof baseButtonVariants>[0]): string {
  return cn(baseButtonVariants(props))
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
