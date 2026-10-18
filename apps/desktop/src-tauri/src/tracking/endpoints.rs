//! Pure endpoint routing for UDP tracking sources (B5 R8, R9, R11).
use std::net::IpAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SourceKind {
    Vmc,
    IFacialMocap,
}

/// One bound UDP socket. The bind address is the bind address of the first source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Endpoint {
    pub kind: SourceKind,
    pub bind_address: IpAddr,
    pub port: u16,
}

/// An enabled source, in scene order. `address` is the VMC sender or the iFacialMocap phone.
#[derive(Debug, Clone, PartialEq)]
pub struct RouteSource {
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
    pub bind_address: IpAddr,
    pub port: u16,
    pub address: Option<IpAddr>,
}

pub type Members = Vec<(String, Option<IpAddr>)>;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Routes {
    pub endpoints: Vec<(Endpoint, Members)>,
    /// (source id, name of the winner)
    pub conflicts: Vec<(String, String)>,
}

fn overlaps(a: IpAddr, b: IpAddr) -> bool {
    a == b || a.is_unspecified() || b.is_unspecified()
}

fn touches(endpoint: &Endpoint, members: &[&RouteSource], source: &RouteSource) -> bool {
    endpoint.port == source.port
        && (overlaps(endpoint.bind_address, source.bind_address)
            || members
                .iter()
                .any(|m| overlaps(m.bind_address, source.bind_address)))
}

fn shares(endpoint: &Endpoint, members: &[&RouteSource], source: &RouteSource) -> bool {
    members.is_empty()
        || (endpoint.kind == source.kind
            && source.address.is_some()
            && members
                .iter()
                .all(|m| m.address.is_some() && m.address != source.address))
}

/// Plans the sockets for the enabled sources. `holders` are the endpoints that are bound now,
/// with their member IDs. A holder keeps its endpoint; the other sources join in scene order.
pub fn endpoint_routes(sources: &[RouteSource], holders: &[(Endpoint, Vec<String>)]) -> Routes {
    let mut groups: Vec<(Endpoint, Vec<&RouteSource>)> = vec![];
    let mut placed = vec![false; sources.len()];
    for (endpoint, ids) in holders {
        let mut members: Vec<&RouteSource> = vec![];
        for (index, source) in sources.iter().enumerate() {
            if placed[index] || !ids.contains(&source.id) {
                continue;
            }
            let fits = source.kind == endpoint.kind
                && source.port == endpoint.port
                && overlaps(source.bind_address, endpoint.bind_address)
                && shares(endpoint, &members, source);
            if fits {
                members.push(source);
                placed[index] = true;
            }
        }
        if !members.is_empty() {
            groups.push((*endpoint, members));
        }
    }
    let mut conflicts = vec![];
    for (index, source) in sources.iter().enumerate() {
        if placed[index] {
            continue;
        }
        let touched: Vec<usize> = groups
            .iter()
            .enumerate()
            .filter(|(_, (e, m))| touches(e, m, source))
            .map(|(i, _)| i)
            .collect();
        match touched.as_slice() {
            [] => groups.push((
                Endpoint {
                    kind: source.kind,
                    bind_address: source.bind_address,
                    port: source.port,
                },
                vec![source],
            )),
            [only] if shares(&groups[*only].0, &groups[*only].1, source) => {
                groups[*only].1.push(source)
            }
            [first, ..] => conflicts.push((source.id.clone(), groups[*first].1[0].name.clone())),
        }
    }
    Routes {
        endpoints: groups
            .into_iter()
            .map(|(e, m)| (e, m.iter().map(|s| (s.id.clone(), s.address)).collect()))
            .collect(),
        conflicts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(id: &str, kind: SourceKind, bind: &str, address: Option<&str>) -> RouteSource {
        RouteSource {
            id: id.into(),
            name: format!("Name {id}"),
            kind,
            bind_address: bind.parse().unwrap(),
            port: 49983,
            address: address.map(|a| a.parse().unwrap()),
        }
    }
    fn phone(id: &str, bind: &str, address: Option<&str>) -> RouteSource {
        source(id, SourceKind::IFacialMocap, bind, address)
    }
    fn ids(routes: &Routes) -> Vec<Vec<&str>> {
        routes
            .endpoints
            .iter()
            .map(|(_, m)| m.iter().map(|(id, _)| id.as_str()).collect())
            .collect()
    }
    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }
    #[test]
    fn two_phones_share_one_endpoint() {
        let routes = endpoint_routes(
            &[
                phone("a", "0.0.0.0", Some("192.168.1.10")),
                phone("b", "0.0.0.0", Some("192.168.1.11")),
            ],
            &[],
        );
        assert_eq!(routes.endpoints.len(), 1);
        assert_eq!(
            routes.endpoints[0].1,
            vec![
                ("a".into(), Some(ip("192.168.1.10"))),
                ("b".into(), Some(ip("192.168.1.11")))
            ]
        );
        assert!(routes.conflicts.is_empty());
    }
    #[test]
    fn unspecified_and_loopback_on_one_port_overlap_and_bind_first_address() {
        let routes = endpoint_routes(
            &[
                phone("a", "127.0.0.1", Some("10.0.0.1")),
                phone("b", "0.0.0.0", Some("10.0.0.2")),
            ],
            &[],
        );
        assert_eq!(ids(&routes), vec![vec!["a", "b"]]);
        assert_eq!(routes.endpoints[0].0.bind_address, ip("127.0.0.1"));
        let apart = endpoint_routes(
            &[phone("a", "127.0.0.1", None), phone("b", "127.0.0.2", None)],
            &[],
        );
        assert_eq!(ids(&apart), vec![vec!["a"], vec!["b"]]);
    }
    #[test]
    fn source_without_address_conflicts_only_on_overlap() {
        let alone = endpoint_routes(&[phone("a", "0.0.0.0", None)], &[]);
        assert_eq!(ids(&alone), vec![vec!["a"]]);
        let mut other_port = phone("b", "0.0.0.0", None);
        other_port.port = 39539;
        let apart = endpoint_routes(&[phone("a", "0.0.0.0", None), other_port], &[]);
        assert!(apart.conflicts.is_empty());
        let both = endpoint_routes(
            &[
                phone("a", "0.0.0.0", Some("10.0.0.1")),
                phone("b", "0.0.0.0", None),
            ],
            &[],
        );
        assert_eq!(ids(&both), vec![vec!["a"]]);
        assert_eq!(both.conflicts, vec![("b".into(), "Name a".into())]);
    }
    #[test]
    fn equal_addresses_conflict() {
        let routes = endpoint_routes(
            &[
                phone("a", "0.0.0.0", Some("10.0.0.1")),
                phone("b", "0.0.0.0", Some("10.0.0.1")),
            ],
            &[],
        );
        assert_eq!(ids(&routes), vec![vec!["a"]]);
        assert_eq!(routes.conflicts, vec![("b".into(), "Name a".into())]);
    }
    #[test]
    fn vmc_and_ifacial_on_one_port_conflict() {
        let routes = endpoint_routes(
            &[
                source("v", SourceKind::Vmc, "0.0.0.0", Some("10.0.0.1")),
                phone("f", "0.0.0.0", Some("10.0.0.2")),
            ],
            &[],
        );
        assert_eq!(ids(&routes), vec![vec!["v"]]);
        assert_eq!(routes.conflicts, vec![("f".into(), "Name v".into())]);
    }
    #[test]
    fn holder_keeps_endpoint_when_earlier_source_joins() {
        let held = Endpoint {
            kind: SourceKind::IFacialMocap,
            bind_address: ip("0.0.0.0"),
            port: 49983,
        };
        let routes = endpoint_routes(
            &[
                phone("early", "0.0.0.0", None),
                phone("holder", "0.0.0.0", None),
            ],
            &[(held, vec!["holder".into()])],
        );
        assert_eq!(
            routes.endpoints,
            vec![(held, vec![("holder".into(), None)])]
        );
        assert_eq!(
            routes.conflicts,
            vec![("early".into(), "Name holder".into())]
        );
    }
    #[test]
    fn scene_order_picks_winner_on_cold_start() {
        let routes = endpoint_routes(
            &[
                phone("first", "0.0.0.0", None),
                phone("second", "0.0.0.0", None),
            ],
            &[],
        );
        assert_eq!(ids(&routes), vec![vec!["first"]]);
        assert_eq!(
            routes.conflicts,
            vec![("second".into(), "Name first".into())]
        );
    }
    #[test]
    fn source_in_error_gets_endpoint_when_holder_leaves() {
        let held = Endpoint {
            kind: SourceKind::IFacialMocap,
            bind_address: ip("0.0.0.0"),
            port: 49983,
        };
        let sources = [
            phone("waiting", "0.0.0.0", None),
            phone("holder", "0.0.0.0", None),
        ];
        let before = endpoint_routes(&sources, &[(held, vec!["holder".into()])]);
        assert_eq!(before.conflicts.len(), 1);
        let after = endpoint_routes(&sources[..1], &[(held, vec!["holder".into()])]);
        assert_eq!(ids(&after), vec![vec!["waiting"]]);
        assert!(after.conflicts.is_empty());
    }
    #[test]
    fn held_endpoint_keeps_its_bind_address_when_first_member_leaves() {
        let held = Endpoint {
            kind: SourceKind::IFacialMocap,
            bind_address: ip("127.0.0.1"),
            port: 49983,
        };
        let routes = endpoint_routes(
            &[phone("b", "0.0.0.0", Some("10.0.0.2"))],
            &[(held, vec!["a".into(), "b".into()])],
        );
        assert_eq!(
            routes.endpoints,
            vec![(held, vec![("b".into(), Some(ip("10.0.0.2")))])]
        );
    }
}
