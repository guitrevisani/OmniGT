// /src/app/[slug]/layout.js
import { getEvent } from "@/lib/events"

export async function generateMetadata(props) {
  const { slug } = await props.params
  const event = await getEvent(slug)

  return {
    title: event?.name || slug,
  }
}

export default async function EventLayout({ children, params }) {
  // Se params.slug for Promise, use await
  const slug = await params.slug

  // Buscar evento pelo slug
  const event = await getEvent(slug)

  if (!event) {
    return <p>Evento não encontrado</p>
  }

  return (
    <div style={{ maxWidth: 800, margin: "2rem auto", fontFamily: "sans-serif" }}>
      

      <main>{children}</main>
    </div>
  )
}
