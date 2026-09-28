import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Mail, MessageCircle, X, ZoomIn } from "lucide-react";
import wechat from "../assets/contact/wechat.jpg";
import xiaohongshu from "../assets/contact/xiaohongshu.jpg";
import douyin from "../assets/contact/douyin.jpg";
import channels from "../assets/contact/channels.jpg";
import bilibili from "../assets/contact/bilibili.jpg";
import "./contact-blogger.css";

export const contactCards = [
  { label: "微信", image: wechat },
  { label: "小红书", image: xiaohongshu },
  { label: "抖音", image: douyin },
  { label: "视频号", image: channels },
  { label: "B站", image: bilibili },
];

export function ContactDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="contact-dialog" aria-labelledby="contact-title"
    onCancel={(event) => { event.preventDefault(); selected === null ? onClose() : setSelected(null); }}>
    <header className="contact-head"><div><span>智见洞察 · 保持联系</span><h2 id="contact-title">联系博主</h2><p>交流使用心得，关注更多 AI 实践。</p></div><button type="button" autoFocus className="contact-close" onClick={onClose} aria-label="关闭联系博主"><X/></button></header>
    <div className="contact-body">
      <div className="contact-details"><div><MessageCircle size={19}/><span>微信号</span><strong>zzshare147</strong></div><div><Mail size={19}/><span>邮箱</span><a href="mailto:1209655870@qq.com">1209655870@qq.com</a></div></div>
      {selected === null ? <>
        <p className="contact-hint">按平台扫码联系或关注，点击图片可放大查看。</p>
        <div className="contact-grid">{contactCards.map((card, index) => <figure key={card.label}><figcaption>{card.label}</figcaption><button type="button" className="contact-image-button" onClick={() => setSelected(index)} aria-label={`放大${card.label}图片`}><img src={card.image} alt={`智见洞察的${card.label}联系二维码`}/><span><ZoomIn size={15}/>放大查看</span></button></figure>)}</div>
      </> : <div className="contact-expanded"><button type="button" className="contact-back" onClick={() => setSelected(null)}><ArrowLeft size={17}/>返回五个平台</button><h3>{contactCards[selected].label}</h3><img src={contactCards[selected].image} alt={`智见洞察的${contactCards[selected].label}联系二维码大图`}/></div>}
    </div>
  </dialog>;
}

export function ContactBlogger({ variant = "login", onOpen }: { variant?: "login" | "sidebar"; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={variant === "login" ? "contact-blogger-trigger" : "contact-sidebar-trigger"} onClick={() => { setOpen(true); onOpen?.(); }}><MessageCircle size={17}/><span>联系博主</span></button>{open && createPortal(<ContactDialog onClose={() => setOpen(false)}/>, document.body)}</>;
}
