# Local dev server for machines without Python/Node (system Ruby only).
# Serves the static app from this directory and proxies /api/* to the live
# Netlify deployment, so the map shows real Piano Log + calendar data.
#
#   ruby serve.rb          # http://localhost:8641
require 'webrick'
require 'net/http'
require 'uri'

PORT = (ENV['PORT'] || 8641).to_i
LIVE = 'https://blpstoremap.netlify.app'

server = WEBrick::HTTPServer.new(
  Port: PORT,
  DocumentRoot: File.dirname(File.expand_path(__FILE__)),
  AccessLog: [[$stderr, '%m %U %s']],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)

# local-only: /api/cardphoto fetches the Drive thumbnail here, so the card
# photo works locally before netlify/functions/cardphoto.mjs is deployed
server.mount_proc '/api/cardphoto' do |req, res|
  id = req.query['id'].to_s
  w = req.query['w'].to_s.empty? ? 320 : [[req.query['w'].to_i, 80].max, 1600].min
  if id !~ /\A[A-Za-z0-9_-]{20,80}\z/
    res.status = 400; res.body = 'bad id'; next
  end
  uri = URI("https://lh3.googleusercontent.com/d/#{id}=w#{w}")
  begin
    r = nil
    4.times do
      r = Net::HTTP.get_response(uri)
      break unless r.is_a?(Net::HTTPRedirection)
      uri = URI(r['location'])
    end
    res.status = r.code.to_i
    res['Content-Type'] = r['Content-Type'] || 'image/jpeg'
    res['Cache-Control'] = 'public, max-age=604800'
    res.body = r.body
  rescue StandardError => e
    res.status = 502; res.body = e.message
  end
end

server.mount_proc '/api' do |req, res|
  uri = URI(LIVE + req.request_uri.path +
            (req.request_uri.query ? '?' + req.request_uri.query : ''))
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 15
  http.read_timeout = 30
  begin
    proxied =
      if req.request_method == 'POST'
        p = Net::HTTP::Post.new(uri)
        p.body = req.body
        p['Content-Type'] = req['Content-Type'] || 'application/json'
        http.request(p)
      else
        http.request(Net::HTTP::Get.new(uri))
      end
    res.status = proxied.code.to_i
    res['Content-Type'] = proxied['Content-Type'] || 'application/json'
    res.body = proxied.body
  rescue StandardError => e
    res.status = 502
    res['Content-Type'] = 'application/json'
    res.body = ({ error: e.message }).to_s
  end
end

trap('INT') { server.shutdown }
server.start
