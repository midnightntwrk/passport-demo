import './name-artwork.css'

/** Decorative illustration. The name and availability remain in the form below. */
export default function NameArtwork({ className = '' }: { className?: string }) {
  return (
    <div className={`mnname-art ${className}`} aria-hidden="true">
      <img src="/welcome-art/name-hero.webp" alt="" />
    </div>
  )
}
