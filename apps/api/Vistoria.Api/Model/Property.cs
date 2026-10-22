using System.Diagnostics.CodeAnalysis;
using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Model;

/// <summary>Imóvel de um cliente (vision.md, "Client, Property e Template").</summary>
[SuppressMessage("Naming", "CA1716", Justification = "Nome do domínio nos docs e no contrato; a API só é consumida em C# e TypeScript.")]
public class Property : SyncEntity
{
    public Guid ClientId { get; set; }
    public string Street { get; set; } = "";
    public string Number { get; set; } = "";      // texto, para aceitar "s/n"
    public string? Complement { get; set; }
    public string District { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";       // sigla da UF
    public string ZipCode { get; set; } = "";     // CEP sem hífen
    public PropertyType Type { get; set; }
    public string? Notes { get; set; }
}
