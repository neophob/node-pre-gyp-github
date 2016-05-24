"use strict";

var request = require('request'),
	path = require("path"),
	fs = require('fs'),
	mime = require('mime'),
	GitHubApi = require("github"),
	cwd = process.cwd();

function NodePreGypGithub() {}

NodePreGypGithub.prototype.github;
NodePreGypGithub.prototype.owner;
NodePreGypGithub.prototype.repo;
NodePreGypGithub.prototype.package_json = {};
NodePreGypGithub.prototype.release = {};
NodePreGypGithub.prototype.stage_dir = path.join(cwd,"build","stage");

NodePreGypGithub.prototype.init = function() {
	var ownerRepo, hostPrefix,
		error = function(){
		process.exit(1);
	};
	
	this.package_json = JSON.parse(fs.readFileSync(path.join(cwd,'package.json')));

	if(!this.package_json.repository || !this.package_json.repository.url){
		console.error('Error: Missing repository.url in package.json');
		error();
	}
	else {
		ownerRepo = this.package_json.repository.url.match(/github\.com\/(.*)(?=\.git)/i);
		if (ownerRepo) {
			ownerRepo = ownerRepo[1].split('/');
			this.owner = ownerRepo[0];
			this.repo = ownerRepo[1];
		}
		else {
			console.error('Error: Not a GitHub repository.url in package.json');
			error();
		}
	}

	hostPrefix = 'https://github.com/' + this.owner + '/' + this.repo + '/releases/download/';
	if(!this.package_json.binary || 'object' !== typeof this.package_json.binary ||
			'string' !== typeof this.package_json.binary.host){
		console.error('Error: Missing binary.host in package.json, configure node-pre-gyp first');
		error();
	}
	else if (this.package_json.binary.host.substr(0, hostPrefix.length) !== hostPrefix){
		console.error('Error: binary.host in package.json should begin with: "' + hostPrefix + '"');
		error();		
	}

	this.github = new GitHubApi({ // set defaults
		// required
		version: "3.0.0",
		// optional
		debug: false,
		protocol: "https",
		host: "api.github.com",
		pathPrefix: "", // for some GHEs; none for GitHub
		timeout: 5000,
		headers: {
			"user-agent": (this.package_json.name) ? this.package_json.name : "node-pre-gyp-github" // GitHub is happy with a unique user agent
		}
	});
};

NodePreGypGithub.prototype.authenticate_settings = function(){
	return {
		type: "oauth",
		token: process.env.NODE_PRE_GYP_GITHUB_TOKEN
	};
};

NodePreGypGithub.prototype.createRelease = function(args, callback) {
	var options = {
		'owner': this.owner,
		'repo': this.repo,
		'tag_name': this.package_json.version,
		'target_commitish': 'master',
		'name': 'v' + this.package_json.version,
		'body': this.package_json.name + ' ' + this.package_json.version,
		'draft': true,
		'prerelease': false
	};
	
	Object.keys(args).forEach(function(key) {
		if(args.hasOwnProperty(key)) {
			options[key] = args[key];
		}
	});
		
	this.github.authenticate(this.authenticate_settings());
	this.github.releases.createRelease(options, callback);
};

NodePreGypGithub.prototype.uploadAsset = function(cfg){
	this.github.authenticate(this.authenticate_settings());
	this.github.releases.uploadAsset({
		owner: this.owner,
		id: this.release.id,
		repo: this.repo,
		name: cfg.fileName,
		filePath: cfg.filePath
	}, function(err){
		if(err) {console.error(err); return;}
		console.log('Staged file ' + cfg.fileName + ' saved to ' + this.owner + '/' +  this.repo + ' release ' + this.release.tag_name + ' successfully.');
	}.bind(this));
};

NodePreGypGithub.prototype.uploadAssets = function(){
	var asset;
	console.log("Stage directory path: " + path.join(this.stage_dir));
	fs.readdir(path.join(this.stage_dir), function(err, files){
		if(typeof files === 'undefined') {console.log('no files found'); return;}
		files.forEach(function(file){
			asset = this.release.assets.filter(function(element, index, array){
				return element.name === file;
			});
			if(asset.length) {
				console.log("Staged file " + file + " found but it already exists in release " + this.release.tag_name + ". If you would like to replace it, you must first manually delete it within GitHub.");
			}
			else {
				console.log("Staged file " + file + " found. Proceeding to upload it.");
				this.uploadAsset({
					fileName: file,
					filePath: path.join(this.stage_dir, file)
				});
			}
		}.bind(this));
	}.bind(this));
};

NodePreGypGithub.prototype.publish = function(options) {
	this.init();
	this.github.authenticate(this.authenticate_settings());
	this.github.releases.listReleases({
		'owner': this.owner,
		'repo': this.repo
	}, function(err, data){
		var release;
		
		if(err) {console.error(err); return;}
		
		// when remote_path is set expect files to be in stage_dir / remote_path after substitution
		if (this.package_json.binary.remote_path) {
			options.tag_name = this.package_json.binary.remote_path.replace(/{version}/g, this.package_json.version);
			this.stage_dir = path.join(this.stage_dir, options.tag_name);
		} else {
			options.tag_name = this.package_json.version;
		}
		
		release	= (function(){ // create a new array containing only those who have a matching version.
			data = data.filter(function(element, index, array){
				return element.tag_name === options.tag_name;
			}.bind(this));
			return data;
		}.bind(this))();
		
		this.release = release[0];
		
		if(!release.length) {
			this.createRelease(options, function(err, release) {
				this.release = release;
				console.log('Release ' + this.package_json.version + " not found, so a draft release was created. YOU MUST MANUALLY PUBLISH THIS DRAFT WITHIN GITHUB FOR IT TO BE ACCESSIBLE.");
				this.uploadAssets();
			}.bind(this));
		}
		else {
			this.uploadAssets();
		}
	}.bind(this));
};

module.exports = NodePreGypGithub;