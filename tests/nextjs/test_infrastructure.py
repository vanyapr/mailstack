import importlib.util, hashlib, json, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'deploy/bin'))
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
nginx=load('nginx_apply','deploy/bin/nginx_apply.py');host=load('hostops','deploy/bin/hostops.py');tls=load('tls_deploy','deploy/bin/tls_deploy.py');cli=load('mailstack_cli','cli/mailstack.py')
class Infrastructure(unittest.TestCase):
    def test_nginx_invalid_candidate_restores_old_route(self):
        with tempfile.TemporaryDirectory() as temp:
            target=pathlib.Path(temp)/'active.conf';candidate=pathlib.Path(temp)/'candidate.conf';old=nginx.MARKER+b'old';target.write_bytes(old);candidate.write_bytes(nginx.MARKER+b'invalid');calls=[]
            def runner(args,**kwargs):
                calls.append(args)
                if len(calls)==1:raise subprocess.CalledProcessError(1,args)
            with self.assertRaisesRegex(RuntimeError,'restored'):nginx.apply(candidate,target,runner)
            self.assertEqual(target.read_bytes(),old);self.assertEqual(len(calls),3)
    def test_nginx_first_install_and_reload_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            target=pathlib.Path(temp)/'active.conf';candidate=pathlib.Path(temp)/'candidate.conf';candidate.write_bytes(nginx.MARKER+b'valid');calls=[]
            def runner(args,**kwargs):
                calls.append(args)
                if len(calls)==2:raise subprocess.CalledProcessError(1,args)
            with self.assertRaises(RuntimeError):nginx.apply(candidate,target,runner)
            self.assertFalse(target.exists());self.assertEqual(len(calls),4)
    def test_nginx_foreign_and_symlink_are_never_adopted(self):
        with tempfile.TemporaryDirectory() as temp:
            target=pathlib.Path(temp)/'active.conf';candidate=pathlib.Path(temp)/'candidate.conf';candidate.write_bytes(nginx.MARKER+b'new');target.write_text('foreign')
            with self.assertRaises(ValueError):nginx.apply(candidate,target)
            self.assertEqual(target.read_text(),'foreign');target.unlink();target.symlink_to(candidate)
            with self.assertRaises(ValueError):nginx.apply(candidate,target)
    def test_dns_fail_closed_for_missing_or_changed_contract(self):
        value={'Domain':'example.test',**{name:{'Errors':[]} for name in host.DNS_SECTIONS}};self.assertTrue(host.dns_ready(value,'example.test'))
        for section in host.DNS_SECTIONS:
            missing=value.copy();missing.pop(section);self.assertFalse(host.dns_ready(missing,'example.test'))
            error={**value,section:{'Errors':['failure']}};self.assertFalse(host.dns_ready(error,'example.test'))
        self.assertFalse(host.dns_ready(value,'other.test'));self.assertFalse(host.dns_ready([], 'example.test'))
    def test_certificate_san_key_chain_checks(self):
        with tempfile.TemporaryDirectory() as temp:
            p=pathlib.Path(temp);subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','3','-subj','/CN=mail.example.test','-addext','subjectAltName=DNS:mail.example.test','-keyout',str(p/'privkey.pem'),'-out',str(p/'fullchain.pem')],check=True,capture_output=True)
            self.assertEqual(len(tls.validate(p,['mail.example.test'],True)),64)
            with self.assertRaisesRegex(ValueError,'SAN'):tls.validate(p,['missing.example.test'],True)
            with self.assertRaises(subprocess.CalledProcessError):tls.validate(p,['mail.example.test'],False)
    def test_cli_does_not_accept_secrets_in_url_or_insecure_remote(self):
        base={'ssh_host':'127.0.0.1','ssh_user':'tester','domain':'example.test','hostname':'mail.example.test','first_address':'alice@example.test','admin_password':'synthetic-password','first_password':'synthetic-password','restic_password':'synthetic-password','mode':'connect','mox_origin':'http://127.0.0.1:1080'}
        self.assertEqual(cli.validate(base.copy())['mode'],'connect')
        self.assertTrue(cli.validate({**base,'push_enabled':True})['push_enabled'])
        for value in ['false','0',1]:
            with self.assertRaises(cli.ConfigError):cli.validate({**base,'push_enabled':value})
        self.assertEqual(cli.validate({**base,'domain':'xn--e1afmkfd.xn--p1ai','hostname':'mail.xn--e1afmkfd.xn--p1ai','first_address':'alice@xn--e1afmkfd.xn--p1ai'})['domain'],'xn--e1afmkfd.xn--p1ai')
        for origin in ['http://192.0.2.5:1080','https://user:password@host.test','http://127.0.0.1:1080/admin/']:
            with self.assertRaises(cli.ConfigError):cli.validate({**base,'mox_origin':origin})
        with self.assertRaises(cli.ConfigError):cli.validate({**base,'certificate_mode':'lab'})
        with self.assertRaises(cli.ConfigError):cli.validate({**base,'backup_repository':'/same-host'})
    def test_offline_image_bundle_is_portable_and_checks_corruption(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=pathlib.Path(temp);images={}
            for service,digit in [('mox','a'),('web','b')]:
                data=('synthetic-'+service).encode();(directory/(service+'.tar')).write_bytes(data);images[service]={'id':'sha256:'+digit*64,'archive':service+'.tar','sha256':hashlib.sha256(data).hexdigest()}
            manifest=directory/'images.json';manifest.write_text(json.dumps({'schema':1,'architecture':'arm64','moxVersion':'v0.0.17-mailstack.6-nextjs','images':images}))
            with patch.object(cli.subprocess,'check_output',return_value='aarch64\n'):
                cfg={'ssh_user':'fixture','ssh_host':'127.0.0.1'};result=cli.image_manifest(cfg,str(manifest));self.assertEqual(result['images']['web']['archive'],str((directory/'web.tar').resolve()))
                (directory/'web.tar').write_bytes(b'corrupt')
                with self.assertRaises(cli.ConfigError):cli.image_manifest(cfg,str(manifest))
    def test_source6_version_gates_match_the_built_candidate(self):
        version='v0.0.17-mailstack.6-nextjs'
        for path in ['cli/mailstack.py','deploy/ansible/roles/docker/tasks/main.yml']:
            with self.subTest(path=path):
                self.assertTrue(version in (ROOT/path).read_text(),path+' must accept the built generation')
                self.assertTrue('v0.0.17-mailstack.4-nextjs' not in (ROOT/path).read_text(),path+' must reject stale app bundles')
    def test_restore_checks_source6_and_preserves_known_source4_recovery(self):
        for generation in ['v0.0.17-mailstack.6-nextjs','v0.0.17-mailstack.4-nextjs','v0.0.18-unaccepted']:
            with self.subTest(generation=generation), tempfile.TemporaryDirectory() as temp:
                directory=pathlib.Path(temp);native_calls=[]
                def restore_fixture(config,*args,**kwargs):
                    if args[0]=='restore':
                        stage=pathlib.Path(args[args.index('--target')+1])/'stage';(stage/'mox/data').mkdir(parents=True);(stage/'tls').mkdir()
                        (stage/'manifest.json').write_text(json.dumps({'schema':1,'moxImage':'sha256:'+'a'*64}))
                def runner(args,**kwargs):
                    native_calls.append(args)
                    return subprocess.CompletedProcess(args,0,stdout=(generation+'-go1.27.2 linux/arm64').encode())
                with patch.object(host,'ROOT',directory), patch.object(host,'restic',side_effect=restore_fixture), patch.object(host,'run',side_effect=runner), patch.object(host,'backups_update'):
                    if 'unaccepted' in generation:
                        with self.assertRaisesRegex(ValueError,'compatibility'):host.restore({},'a'*64)
                        self.assertFalse(any('verifydata' in args for args in native_calls))
                        self.assertFalse(list(directory.rglob('RECOVERY-NOT-ACTIVE.json')))
                    else:
                        result=host.restore({},'a'*64);self.assertTrue(result['verified']);self.assertFalse(result['active'])
                        verification=next(args for args in native_calls if 'verifydata' in args)
                        self.assertIn('--network',verification);self.assertIn('none',verification)
                        self.assertTrue(list(directory.rglob('RECOVERY-NOT-ACTIVE.json')))
    def test_restore_requires_concrete_snapshot_before_any_operation(self):
        for value in ['latest','', '../../data',None]:
            with self.assertRaises((ValueError,TypeError)):host.restore({},value)
if __name__=='__main__':unittest.main()
