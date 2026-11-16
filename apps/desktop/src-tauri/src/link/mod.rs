//! App links (B39): `opensekai://blueprint/import?url=…`. The OS gives a link to `source`, the
//! host parses it (`parse`), keeps one link (`inbox`), and downloads the file with limits
//! (`fetch`). The Editor window pulls the result with two commands that take no arguments.
pub mod fetch;
pub mod parse;
