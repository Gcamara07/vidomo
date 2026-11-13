import { redirect } from 'next/navigation';

// Por enquanto a raiz leva direto à demo.
// TODO(portal público): lista de empreendimentos publicados no lugar deste redirecionamento.
export default function Home() {
  redirect('/e/residencial-vista');
}
