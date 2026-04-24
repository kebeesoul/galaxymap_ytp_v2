import { redirect } from 'next/navigation'

interface Props {
  params: { id: string }
}

export default function ProjectDetailPage({ params }: Props) {
  redirect(`/editor/${params.id}`)
}
