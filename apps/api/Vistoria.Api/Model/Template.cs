using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Model;

/// <summary>
/// Roteiro: molde de ambientes e itens copiado ao criar uma vistoria (vision.md, "Client, Property e Template").
/// Ambientes e itens são tipos complexos numa coluna JSON só: o roteiro nunca é consultado por item.
/// </summary>
public class Template : SyncEntity
{
    public string Name { get; set; } = "";
    public List<TemplateRoom> Rooms { get; set; } = [];
}

/// <summary>Ambiente do roteiro. Sem versão nem tabela própria; o <c>Id</c> é do cliente.</summary>
public class TemplateRoom
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public int Position { get; set; }
    public List<TemplateItem> Items { get; set; } = [];
}

/// <summary>Item de um ambiente do roteiro.</summary>
public class TemplateItem
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public int Position { get; set; }
}
