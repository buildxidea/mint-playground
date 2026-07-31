import dynamic from 'next/dynamic';
import Head from 'next/head';

const GameCanvas = dynamic(() => import('../components/GameCanvas'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Dead Reckoning</title>
        <meta
          name="description"
          content="Play 3D fog-of-war chess against a greedy AI in three sculpted themes."
        />
      </Head>
      <GameCanvas />
    </>
  );
}
