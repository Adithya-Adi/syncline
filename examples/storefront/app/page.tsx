import { Catalogue } from './catalogue';
import { Investigations } from './investigations';
import { Identity } from './identity';

/**
 * The shop.
 *
 * A server component that renders client components — which is worth noticing, because the recorder
 * only ever runs on the client and none of this had to change to accommodate it.
 */
export default function ShopPage() {
  return (
    <>
      <section className="intro">
        <h1>A storefront that records itself</h1>
        <p>
          Every button here makes a real request. The browser SDK records the
          page with rrweb and attaches a <code>traceparent</code> to each call;
          the route handlers continue that trace and export spans back to
          Syncline. Open the recording in the dashboard and the click, the
          request, and the database span underneath it sit on one timeline.
        </p>
      </section>

      <Identity />
      <Catalogue />
      <Investigations />
    </>
  );
}
